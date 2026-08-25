import { randomUUID } from 'node:crypto'
import type { CFVersion, FlowPlan, Json, ResolvedResource, FlowNode } from './types.js'
import { assertContract } from './contract.js'
import { Store } from './db.js'
import { sha256 } from './hash.js'

export interface Executor {
  id: string
  execute(
    task: string,
    input: Json,
    signal: AbortSignal,
    resources?: ResolvedResource[],
  ): Promise<Json>
}
export class ExecutorRegistry {
  private map = new Map<string, Executor>()
  register(executor: Executor) {
    this.map.set(executor.id, executor)
    return this
  }
  get(id: string) {
    const executor = this.map.get(id)
    if (!executor) throw new Error(`UNKNOWN_EXECUTOR:${id}`)
    return executor
  }
}
type Status = 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'inactive'

export class Engine {
  private active = new Set<string>()
  private controllers = new Map<string, AbortController>()
  constructor(
    private store: Store,
    private executors: ExecutorRegistry,
    private cfVersions: () => CFVersion[],
  ) {}
  start(runId: string, plan: FlowPlan) {
    if (this.active.has(runId)) return
    this.active.add(runId)
    void this.run(runId, plan).finally(() => {
      this.active.delete(runId)
      this.controllers.delete(runId)
      this.store.finishJob(runId)
    })
  }
  cancel(runId: string) {
    const controller = this.controllers.get(runId)
    if (!controller) return false
    controller.abort()
    return true
  }
  private async run(runId: string, plan: FlowPlan) {
    const { planHash, ...planBody } = plan
    if (sha256(planBody) !== planHash) {
      this.store.setRun(runId, 'failed', { code: 'PLAN_HASH_MISMATCH' })
      this.store.append(runId, 'run.failed', undefined, { code: 'PLAN_HASH_MISMATCH' })
      return
    }
    const run = this.store.getRun(runId)
    const initial = (run?.input as Json) ?? {}
    const resources = (run?.resources as ResolvedResource[]) ?? []
    const requiredResources = plan.resources?.filter((requirement) => requirement.required) ?? []
    if (
      requiredResources.some(
        (requirement) => !resources.some((resource) => resource.requirementId === requirement.id),
      )
    ) {
      this.store.setRun(runId, 'failed', { code: 'RESOURCE_BINDING_MISSING' })
      this.store.append(runId, 'run.failed', undefined, { code: 'RESOURCE_BINDING_MISSING' })
      return
    }
    this.store.setRun(runId, 'running')
    this.store.append(runId, 'run.started')
    if (resources.length) {
      this.store.append(runId, 'resources.bound', undefined, {
        profileId: resources[0].profileId,
        resources: resources.map(({ requirementId, resourceId, type, access }) => ({
          requirementId,
          resourceId,
          type,
          access,
        })),
      })
    }
    const values = new Map<number, Json>()
    const statuses = new Map<number, Status>()
    for (const event of this.store.events(runId)) {
      if (event.node === undefined) continue
      if (event.type === 'node.completed') {
        values.set(event.node, (event.data as any)?.value as Json)
        statuses.set(event.node, 'completed')
      }
      if (event.type === 'node.failed') statuses.set(event.node, 'failed')
      if (event.type === 'node.inactive') statuses.set(event.node, 'inactive')
      if (event.type === 'approval.approved' || event.type === 'approval.rejected') {
        values.set(event.node, event.type.slice('approval.'.length) as Json)
        statuses.set(event.node, 'completed')
      }
    }
    const controller = new AbortController()
    this.controllers.set(runId, controller)
    let dispatched = [...statuses.values()].filter((s) => s !== 'inactive').length
    while (true) {
      if (controller.signal.aborted) {
        this.store.setRun(runId, 'cancelled')
        this.store.append(runId, 'run.cancelled')
        return
      }
      const transitions = this.resolveTransitions(plan, statuses, values)
      for (const [index, status] of transitions) {
        if (status === 'inactive' || status === 'blocked') {
          statuses.set(index, status)
          this.store.append(runId, `node.${status}`, index)
        }
        if (status === 'failed') {
          statuses.set(index, status)
          this.store.append(runId, 'node.failed', index, { error: 'UPSTREAM_FAILURE' })
        }
      }
      const output = plan.nodes.find(
        (node) => node.kind === 'output' && statuses.get(node.index) === 'completed',
      )
      if (output) {
        this.store.setRun(runId, 'completed', {
          outputId: (output as any).outputId,
          value: values.get(output.index) ?? null,
        })
        this.store.append(runId, 'run.completed', undefined, { outputId: (output as any).outputId })
        return
      }
      if ([...statuses.values()].some((s) => s === 'failed' || s === 'blocked')) {
        this.store.setRun(runId, 'failed')
        this.store.append(runId, 'run.failed')
        return
      }
      if (dispatched >= plan.limits.maxNodeDispatches) {
        this.store.setRun(runId, 'failed', { code: 'STEP_LIMIT_EXCEEDED' })
        this.store.append(runId, 'run.failed', undefined, { code: 'STEP_LIMIT_EXCEEDED' })
        return
      }
      const ready = plan.nodes
        .filter(
          (node) => !statuses.has(node.index) && this.isReady(node.index, plan, statuses, values),
        )
        .map((node) => node.index)
      if (!ready.length) {
        if (statuses.size === plan.nodes.length) {
          this.store.setRun(runId, 'failed', { code: 'NO_TERMINAL_OUTPUT' })
          this.store.append(runId, 'run.failed', undefined, { code: 'NO_TERMINAL_OUTPUT' })
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
        continue
      }
      const approval = ready
        .map((index) => plan.nodes[index])
        .find((node) => node.kind === 'approval')
      if (approval && this.store.approval(runId, approval.index) === undefined) {
        this.store.setRun(runId, 'waiting-approval', {
          node: approval.index,
          policyRef: approval.policyRef,
        })
        this.store.append(runId, 'approval.requested', approval.index, {
          policyRef: approval.policyRef,
        })
        return
      }
      const batch = ready.slice(0, Math.max(1, plan.limits.maxConcurrency))
      await Promise.all(
        batch.map(async (index) => {
          statuses.set(index, 'running')
          dispatched++
          const startedNode = plan.nodes[index]
          this.store.append(
            runId,
            'node.started',
            index,
            startedNode.kind === 'cf-call'
              ? {
                  cfRef: startedNode.cfRef,
                  executor: startedNode.executorProfile ?? {
                    id: startedNode.executor ?? 'default',
                    profileVersion: 0,
                  },
                }
              : { kind: startedNode.kind },
          )
          try {
            const value = await this.executeWithPolicy(
              plan,
              plan.nodes[index],
              values,
              initial,
              controller.signal,
              runId,
              resources,
            )
            values.set(index, value)
            statuses.set(index, 'completed')
            this.store.append(runId, 'node.completed', index, { value })
          } catch (error) {
            statuses.set(index, 'failed')
            this.store.append(runId, 'node.failed', index, {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }),
      )
    }
  }
  private async executeWithPolicy(
    plan: FlowPlan,
    node: FlowPlan['nodes'][number],
    values: Map<number, Json>,
    input: Json,
    signal: AbortSignal,
    runId: string,
    resources: ResolvedResource[],
  ): Promise<Json> {
    const policy = node.kind === 'cf-call' ? node.onError : undefined
    const maxAttempts = policy?.action === 'retry' ? Math.max(1, policy.maxAttempts ?? 1) : 1
    let last: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt > 1) this.store.append(runId, 'node.retry', node.index, { attempt })
        return await this.execute(plan, node, values, input, signal, runId, resources)
      } catch (error) {
        last = error
        if (attempt === maxAttempts) throw error
      }
    }
    throw last instanceof Error ? last : new Error(String(last))
  }
  private edgeState(
    edge: FlowPlan['edges'][number],
    statuses: Map<number, Status>,
    values: Map<number, Json>,
  ): 'active' | 'inactive' | 'pending' {
    if (edge.from === '$entry') return 'active'
    const source = statuses.get(edge.from)
    if (!source || source === 'running' || source === 'pending') return 'pending'
    const outcome = edge.when?.outcome ?? 'completed'
    if (outcome === 'failed') return source === 'failed' ? 'active' : 'inactive'
    if (outcome === 'branch-case' || outcome === 'approved' || outcome === 'rejected')
      return source === 'completed'
        ? values.get(edge.from) === (edge.when?.caseId ?? outcome)
          ? 'active'
          : 'inactive'
        : 'inactive'
    return source === 'completed' ? 'active' : 'inactive'
  }
  private failedDependency(
    node: FlowNode & { index: number },
    incoming: FlowPlan['edges'],
    statuses: Map<number, Status>,
  ) {
    if (node.kind === 'join' && node.onUpstreamFailure === 'continue-eligible') return false
    return incoming.some(
      (edge) =>
        typeof edge.from === 'number' &&
        statuses.get(edge.from) === 'failed' &&
        edge.when?.outcome !== 'failed',
    )
  }
  private resolveTransitions(
    plan: FlowPlan,
    statuses: Map<number, Status>,
    values: Map<number, Json>,
  ): Array<[number, Status]> {
    const out: Array<[number, Status]> = []
    for (const node of plan.nodes) {
      if (statuses.has(node.index)) continue
      const incoming = plan.edges.filter((edge) => edge.to === node.index)
      if (!incoming.length) continue
      const states = incoming.map((edge) => this.edgeState(edge, statuses, values))
      if (states.some((state) => state === 'pending')) continue
      const active = states.filter((state) => state === 'active').length
      if (this.failedDependency(node, incoming, statuses)) {
        out.push([node.index, 'blocked'])
        continue
      }
      if (!active) {
        out.push([node.index, node.kind === 'output' ? 'inactive' : 'blocked'])
        continue
      }
    }
    return out
  }
  private isReady(
    index: number,
    plan: FlowPlan,
    statuses: Map<number, Status>,
    values: Map<number, Json>,
  ) {
    const node = plan.nodes[index]
    const incoming = plan.edges.filter((edge) => edge.to === index)
    const states = incoming.map((edge) => this.edgeState(edge, statuses, values))
    if (
      !incoming.length ||
      states.some((state) => state === 'pending') ||
      !states.includes('active') ||
      this.failedDependency(node, incoming, statuses)
    )
      return false
    return true
  }
  private async execute(
    plan: FlowPlan,
    node: FlowPlan['nodes'][number],
    values: Map<number, Json>,
    runInput: Json,
    signal: AbortSignal,
    runId: string,
    resources: ResolvedResource[],
  ): Promise<Json> {
    const input = this.inputFor(node.index, plan, values, runInput)
    if (node.kind === 'cf-call') {
      if (resources.length)
        this.store.append(runId, 'resource.access', node.index, {
          resources: resources.map(({ requirementId, resourceId, type, access }) => ({
            requirementId,
            resourceId,
            type,
            access,
          })),
        })
      const version = this.cfVersions().find(
        (value) => value.cfId === node.cfRef.cfId && value.version === node.cfRef.version,
      )
      if (!version) throw new Error('CF_VERSION_NOT_FOUND')
      if (
        sha256({
          inputContract: version.draft.inputContract,
          outputContract: version.draft.outputContract,
          program: version.program,
        }) !== version.programHash
      )
        throw new Error('PROGRAM_HASH_MISMATCH')
      assertContract(node.inputContract ?? version.draft.inputContract, input, 'CF_INPUT')
      const output = await this.executeCF(
        version,
        input,
        node.executorProfile
          ? `${node.executorProfile.id}@${node.executorProfile.profileVersion}`
          : node.executor ?? version.draft.defaultExecutor ?? 'echo',
        signal,
        resources,
      )
      assertContract(node.outputContract ?? version.draft.outputContract, output, 'CF_OUTPUT')
      return output
    }
    if (node.kind === 'branch') return this.evaluate(node.cond, input)
    if (node.kind === 'join') return { status: 'joined' }
    if (node.kind === 'approval') return 'approved'
    if (node.kind === 'output') return input
    throw new Error('UNKNOWN_NODE')
  }
  private async executeCF(
    version: CFVersion,
    input: Json,
    executorId: string,
    signal: AbortSignal,
    resources: ResolvedResource[],
  ): Promise<Json> {
    let current = version.program.entry
    const local: Record<string, Json> = {}
    let count = 0
    const steps = new Map(version.program.steps.map((step) => [step.index, step]))
    while (count++ < version.program.limits.maxStepExecutions) {
      if (signal.aborted) throw new Error('ABORTED')
      const step = steps.get(current)
      if (!step) throw new Error('BAD_STEP')
      if (step.kind === 'return') return this.resolve(step.source ?? input, input, local)
      if (step.kind === 'guard') {
        current = this.evaluate(step.cond, input, local) ? step.then : step.else
        continue
      }
      const executorIdForStep = step.kind === 'call' ? step.target.ref.id : executorId
      const task = step.kind === 'call' ? JSON.stringify(step.target) : step.task
      const stepInput = this.resolve(step.input ?? input, input, local)
      const maxAttempts =
        step.onError?.action === 'retry' ? Math.max(1, step.onError.maxAttempts) : 1
      let output: Json | undefined
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          output = await this.executors
            .get(executorIdForStep)
            .execute(task, stepInput, signal, resources)
          break
        } catch (error) {
          if (step.onError?.action === 'continue') {
            output = step.onError.fallback
            break
          }
          if (attempt === maxAttempts) throw error
        }
      }
      local[String(step.index)] = output ?? null
      current = step.next!
    }
    throw new Error('STEP_LIMIT_EXCEEDED')
  }
  private inputFor(index: number, plan: FlowPlan, values: Map<number, Json>, runInput: Json): Json {
    const input: Record<string, Json> = {}
    const node = plan.nodes[index]
    for (const binding of plan.bindings.filter(
      (value) => value.to.startsWith(`${node.id}.`) || value.to.startsWith(`$${index}.`),
    )) {
      const path = binding.from.slice('$user.'.length)
      input[binding.to.split('.').pop()!] = binding.from.startsWith('$user.')
        ? path === 'input'
          ? runInput
          : this.path(runInput, path.startsWith('input.') ? path.slice(6) : path)
        : this.resolveRef(binding.from, plan, values)
    }
    return Object.keys(input).length ? input : ((node as any).inputDefaults ?? {})
  }
  private resolveRef(ref: string, plan: FlowPlan, values: Map<number, Json>): Json {
    const match = /^\$?([\w-]+)\.output(?:\.(.*))?$/.exec(ref)
    if (!match) return ref as Json
    const index = plan.nodes.findIndex(
      (node) => node.id === match[1] || String(node.index) === match[1],
    )
    const value = values.get(index)
    return match[2] ? this.path(value, match[2]) : (value ?? null)
  }
  private resolve(value: Json, input: Json, local: Record<string, Json>): Json {
    if (typeof value !== 'string') return value
    if (value === '$input') return input
    const match = /^\$local\.(\d+)\.output(?:\.(.*))?$/.exec(value)
    if (!match) return value
    const output = local[match[1]]
    return match[2] ? this.path(output, match[2]) : output
  }
  private path(value: Json | undefined, path: string): Json {
    return path.split('.').reduce<any>((current, key) => current?.[key], value) ?? null
  }
  private evaluate(expression: Json, input: Json, local: Record<string, Json> = {}): any {
    if (typeof expression === 'boolean' || typeof expression === 'number') return expression
    if (typeof expression === 'string') return this.resolve(expression, input, local)
    if (expression && typeof expression === 'object' && !Array.isArray(expression)) {
      const op = expression as any
      if ('$eq' in op)
        return this.evaluate(op.$eq[0], input, local) === this.evaluate(op.$eq[1], input, local)
      if ('$and' in op) return op.$and.every((x: Json) => this.evaluate(x, input, local))
      if ('$or' in op) return op.$or.some((x: Json) => this.evaluate(x, input, local))
      if ('$get' in op) return this.path(input, String(op.$get))
    }
    return expression
  }
}
export function builtins() {
  return new ExecutorRegistry()
    .register({ id: 'echo', execute: async (task, input) => ({ task, input }) })
    .register({ id: 'json.identity', execute: async (_task, input) => input })
}
export function newRunId() {
  return randomUUID()
}

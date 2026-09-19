import { randomUUID } from 'node:crypto'
import type {
  CFVersion,
  FlowPlan,
  Json,
  ResolvedResource,
  FlowNode,
  CapabilityEffect,
  RuntimeExecutionError,
  AgentTraceReporter,
} from './types.js'
import { assertContract } from './contract.js'
import { Store } from './db.js'
import { sha256 } from './hash.js'
import { DEMO_RUNTIME_ID, executeDemoCapability } from './demo-runtime.js'
import { extractFiles } from './file-extraction.js'
import { builtinCapabilities } from './builtin-catalog.js'
import { normalizeLocale } from './locale.js'

export interface Executor {
  id: string
  execute(
    task: string,
    input: Json,
    signal: AbortSignal,
    resources?: ResolvedResource[],
    effects?: CapabilityEffect[],
    context?: { workspaceRoot: string },
    trace?: AgentTraceReporter,
  ): Promise<Json>
}
export class ExecutorRegistry {
  private map = new Map<string, Executor>()
  register(executor: Executor) {
    this.map.set(executor.id, executor)
    return this
  }
  unregister(id: string) {
    this.map.delete(id)
  }
  get(id: string) {
    const executor = this.map.get(id)
    if (!executor) throw new Error(`UNKNOWN_EXECUTOR:${id}`)
    return executor
  }
}
type Status = 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'inactive'
type NodeCompletion = {
  index: number
  status: 'completed' | 'failed'
  value?: Json
  error?: string
  details?: unknown
}

type EngineState = {
  statuses: Map<number, Status>
  values: Map<number, Json>
  terminalCandidate: { outputId: string; value: Json } | null
  admissionOpen: boolean
  recoveryRequired: number[]
}

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
    const controller = new AbortController()
    this.controllers.set(runId, controller)
    const state = this.restoreState(runId)
    if (state.recoveryRequired.length) {
      this.store.setRun(runId, 'needs-reconciliation', { nodes: state.recoveryRequired })
      this.store.append(runId, 'run.needs-reconciliation', undefined, {
        nodes: state.recoveryRequired,
      })
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
    const inFlight = new Map<number, Promise<NodeCompletion>>()
    let dispatched = [...state.statuses.values()].filter((s) => s !== 'inactive').length
    while (true) {
      if (controller.signal.aborted) {
        this.store.setRun(runId, 'cancelled')
        this.store.append(runId, 'run.cancelled')
        return
      }
      const transitions = this.settleTransitions(plan, state.statuses, state.values)
      for (const [index, status] of transitions) {
        if (status === 'inactive' || status === 'blocked') {
          state.statuses.set(index, status)
          this.store.append(runId, `node.${status}`, index)
        }
        if (status === 'failed') {
          state.statuses.set(index, status)
          this.store.append(runId, 'node.failed', index, { error: 'UPSTREAM_FAILURE' })
        }
      }
      const output = plan.nodes.find(
        (node) => node.kind === 'output' && state.statuses.get(node.index) === 'completed',
      )
      if (output) {
        state.terminalCandidate ??= {
          outputId: (output as any).outputId,
          value: state.values.get(output.index) ?? null,
        }
        state.admissionOpen = false
      }
      if (state.terminalCandidate && inFlight.size === 0) {
        this.store.setRun(runId, 'completed', {
          outputId: state.terminalCandidate.outputId,
          value: state.terminalCandidate.value,
        })
        this.store.append(runId, 'run.completed', undefined, {
          outputId: state.terminalCandidate.outputId,
        })
        return
      }
      if (
        !state.terminalCandidate &&
        [...state.statuses.values()].some((s) => s === 'failed' || s === 'blocked')
      ) {
        this.store.setRun(runId, 'failed')
        this.store.append(runId, 'run.failed')
        return
      }
      if (!state.terminalCandidate && dispatched >= plan.limits.maxNodeDispatches) {
        this.store.setRun(runId, 'failed', { code: 'STEP_LIMIT_EXCEEDED' })
        this.store.append(runId, 'run.failed', undefined, { code: 'STEP_LIMIT_EXCEEDED' })
        return
      }
      if (state.terminalCandidate) {
        const completion = await Promise.race(inFlight.values())
        inFlight.delete(completion.index)
        if (!this.applyCompletion(runId, plan, state, completion)) return
        continue
      }
      const ready = plan.nodes
        .filter(
          (node) =>
            !state.statuses.has(node.index) &&
            this.isReady(node.index, plan, state.statuses, state.values),
        )
        .map((node) => node.index)
      while (
        ready.length &&
        inFlight.size < Math.max(1, plan.limits.maxConcurrency) &&
        state.admissionOpen
      ) {
        const index = ready.shift()!
        if (state.statuses.has(index) || inFlight.has(index)) continue
        const node = plan.nodes[index]
        state.statuses.set(index, 'running')
        dispatched++
        this.store.append(
          runId,
          'node.started',
          index,
          node.kind === 'cf-call'
            ? {
                cfRef: node.cfRef,
                executor: node.cfRef.cfId.startsWith('builtin:')
                  ? { id: 'file.extract-text', profileVersion: 1 }
                  : (node.executorProfile ?? {
                      id: node.executor ?? 'default',
                      profileVersion: 0,
                    }),
              }
            : { kind: node.kind },
        )
        inFlight.set(
          index,
          this.executeWithPolicy(
            plan,
            node,
            state.values,
            initial,
            controller.signal,
            runId,
            resources,
          ).then(
            (value) => ({ index, status: 'completed' as const, value }),
            (error) => ({
              index,
              status: 'failed' as const,
              error: error instanceof Error ? error.message : String(error),
              details: (error as any)?.details,
            }),
          ),
        )
      }
      if (!inFlight.size) {
        if (state.terminalCandidate) continue
        if (state.statuses.size === plan.nodes.length) {
          this.store.setRun(runId, 'failed', { code: 'NO_TERMINAL_OUTPUT' })
          this.store.append(runId, 'run.failed', undefined, { code: 'NO_TERMINAL_OUTPUT' })
          return
        }
        this.store.setRun(runId, 'failed', { code: 'FLOW_STALLED' })
        this.store.append(runId, 'run.failed', undefined, { code: 'FLOW_STALLED' })
        return
      }
      const completion = await Promise.race(inFlight.values())
      inFlight.delete(completion.index)
      if (!this.applyCompletion(runId, plan, state, completion)) return
    }
  }
  /**
   * Records one settled node into the run state and Ledger.
   * Returns false when the run must halt (unknown effect state needs a human).
   */
  private applyCompletion(
    runId: string,
    plan: FlowPlan,
    state: EngineState,
    completion: NodeCompletion,
  ): boolean {
    const node = plan.nodes[completion.index]
    if (completion.status === 'completed') {
      state.statuses.set(completion.index, 'completed')
      state.values.set(completion.index, completion.value ?? null)
      this.store.append(runId, 'node.completed', completion.index, {
        value: completion.value ?? null,
      })
      if (node.kind === 'output') {
        state.terminalCandidate = { outputId: node.outputId, value: completion.value ?? null }
        state.admissionOpen = false
      }
      return true
    }
    const details = completion.details as RuntimeExecutionError | undefined
    if (details?.effectState === 'unknown') {
      this.store.setRun(runId, 'needs-reconciliation', {
        nodes: [completion.index],
        error: details as unknown as Json,
      })
      this.store.append(runId, 'run.needs-reconciliation', completion.index, {
        error: details as unknown as Json,
      })
      return false
    }
    state.statuses.set(completion.index, 'failed')
    this.store.append(runId, 'node.failed', completion.index, {
      error: completion.error ?? 'UNKNOWN_ERROR',
      ...(details ? { details: details as unknown as Json } : {}),
    })
    return true
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
        const details = (error as any)?.details as
          import('./types.js').RuntimeExecutionError | undefined
        if (details && (!details.retryable || details.effectState === 'unknown')) throw error
        if (attempt === maxAttempts) throw error
      }
    }
    throw last instanceof Error ? last : new Error(String(last))
  }
  private restoreState(runId: string): EngineState {
    const statuses = new Map<number, Status>()
    const values = new Map<number, Json>()
    const started = new Set<number>()
    for (const event of this.store.events(runId)) {
      if (event.node === undefined) continue
      if (event.type === 'node.started') {
        statuses.set(event.node, 'running')
        started.add(event.node)
      }
      if (event.type === 'node.completed') {
        values.set(event.node, (event.data as any)?.value as Json)
        statuses.set(event.node, 'completed')
        started.delete(event.node)
      }
      if (event.type === 'node.failed') {
        statuses.set(event.node, 'failed')
        started.delete(event.node)
      }
      if (event.type === 'node.inactive') {
        statuses.set(event.node, 'inactive')
        started.delete(event.node)
      }
    }
    return {
      statuses,
      values,
      terminalCandidate: null,
      admissionOpen: true,
      recoveryRequired: [...started].filter((index) => statuses.get(index) === 'running'),
    }
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
    if (outcome === 'branch-case')
      return source === 'completed'
        ? values.get(edge.from) === edge.when?.caseId
          ? 'active'
          : 'inactive'
        : 'inactive'
    return source === 'completed' ? 'active' : 'inactive'
  }
  private failedDependency(
    node: FlowNode & { index: number },
    incoming: FlowPlan['edges'],
    statuses: Map<number, Status>,
    values: Map<number, Json>,
  ) {
    if (node.kind === 'join' && node.onUpstreamFailure === 'continue-eligible') return false
    return incoming.some(
      (edge) =>
        typeof edge.from === 'number' &&
        statuses.get(edge.from) === 'failed' &&
        edge.when?.outcome !== 'failed',
    )
  }
  private settleTransitions(
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
      if (node.kind === 'join' && node.mode === 'any') {
        if (states.some((state) => state === 'active')) continue
        if (states.some((state) => state === 'pending')) continue
        if (this.failedDependency(node, incoming, statuses, values)) {
          out.push([node.index, 'blocked'])
          continue
        }
        out.push([node.index, 'inactive'])
        continue
      }
      if (this.failedDependency(node, incoming, statuses, values)) {
        out.push([node.index, 'blocked'])
        continue
      }
      if (states.some((state) => state === 'pending')) continue
      if (!states.includes('active')) out.push([node.index, 'inactive'])
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
    if (!incoming.length) return false
    const states = incoming.map((edge) => this.edgeState(edge, statuses, values))
    // A join in "any" mode fires on the first active upstream edge; every other
    // node needs all upstream edges settled with at least one active.
    if (node.kind === 'join' && node.mode === 'any')
      return states.some((state) => state === 'active')
    return (
      !states.some((state) => state === 'pending') &&
      states.includes('active') &&
      !this.failedDependency(node, incoming, statuses, values)
    )
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
    const input = this.inputContextFor(node.index, plan, values, runInput)
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
      if (!['0.2', '0.3'].includes(version.program.version))
        throw new Error('CF_PROGRAM_VERSION_UNSUPPORTED')
      if (
        sha256({
          inputContract: version.draft.inputContract,
          outputContract: version.draft.outputContract,
          program: version.program,
        }) !== version.programHash
      )
        throw new Error('PROGRAM_HASH_MISMATCH')
      assertContract(node.inputContract ?? version.draft.inputContract, input, 'CF_INPUT')
      if (signal.aborted) throw new Error('ABORTED')
      if (version.program.version === '0.3') {
        const builtin = builtinCapabilities().find(
          (item) => item.cfId === version.cfId && item.version === version.version,
        )
        if (!builtin || builtin.programHash !== version.programHash)
          throw new Error('BUILTIN_PROGRAM_UNSUPPORTED')
        try {
          const output = await extractFiles(
            node.toolInput!,
            input,
            plan.workspaceRoot,
            signal,
            (type, data) => this.store.append(runId, type, node.index, data),
            normalizeLocale(this.store.settings()?.locale),
          )
          assertContract(
            node.outputContract ?? version.draft.outputContract,
            output as unknown as Json,
            'CF_OUTPUT',
          )
          return output as unknown as Json
        } catch (error) {
          const result = (error as { result?: Json }).result
          if (result) this.store.append(runId, 'tool.result', node.index, { value: result })
          throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
            details: {
              layer: 'engine',
              code: (error as { code?: string }).code ?? 'EXTRACTION_FAILED',
              message: error instanceof Error ? error.message : String(error),
              retryable: false,
              effectState: 'none',
            },
          })
        }
      }
      const executorId = node.executorProfile
        ? `${node.executorProfile.id}@${node.executorProfile.profileVersion}`
        : (node.executor ?? version.draft.defaultExecutor ?? 'echo')
      const invocationId = `agent-${randomUUID()}`
      this.store.createAgentInvocation({
        id: invocationId,
        kind: 'flow-node',
        status: 'running',
        runtimeId: executorId.split('@')[0],
        flowId: plan.flowId,
        runId,
        node: node.index,
      })
      this.store.append(runId, 'agent.invocation', node.index, { invocationId })
      let output: Json
      try {
        output = await this.executors.get(executorId).execute(
          version.program.task,
          input,
          signal,
          resources,
          version.draft.effects ?? [],
          {
            workspaceRoot: plan.workspaceRoot,
          },
          (event) => this.store.appendAgentTrace(invocationId, event),
        )
        if (!this.store.agentTraceEvents(invocationId).length)
          this.store.appendAgentTrace(invocationId, {
            kind: 'notice',
            title: '该 Agent 未提供更细的过程事件',
            detail: '已记录节点开始、完成和结果状态。',
            status: 'completed',
          })
        this.store.setAgentInvocation(invocationId, 'completed')
      } catch (error) {
        this.store.appendAgentTrace(invocationId, {
          kind: 'error',
          title: 'Agent 处理失败',
          status: 'failed',
          detail: error instanceof Error ? error.message : String(error),
        })
        this.store.setAgentInvocation(
          invocationId,
          signal.aborted ? 'interrupted' : 'failed',
          undefined,
          error instanceof Error ? error.message : String(error),
        )
        throw error
      }
      assertContract(node.outputContract ?? version.draft.outputContract, output, 'CF_OUTPUT')
      return output
    }
    if (node.kind === 'branch') return this.evaluate(node.cond, input)
    if (node.kind === 'join') return input
    if (node.kind === 'output') {
      const upstream = (input as any)?.upstream
      if (Array.isArray(upstream) && upstream.length === 1) return upstream[0]?.output ?? null
      return input
    }
    throw new Error('UNKNOWN_NODE')
  }
  private inputContextFor(
    index: number,
    plan: FlowPlan,
    values: Map<number, Json>,
    runInput: Json,
  ): Json {
    const node = plan.nodes[index]
    const incoming = plan.edges.filter((edge) => edge.to === index && typeof edge.from === 'number')
    const upstream = incoming
      .filter((edge) => typeof edge.from === 'number' && values.has(edge.from))
      .map((edge) => {
        const sourceIndex = edge.from as unknown as number
        const source = plan.nodes[sourceIndex]
        return {
          nodeId: source.id,
          nodeName: this.nodeName(source),
          output: values.get(sourceIndex) ?? null,
        }
      })
    return {
      flowInput: runInput ?? {},
      upstream,
      ...(upstream.length === 0 && (node as any).inputDefaults !== undefined
        ? { inputDefaults: (node as any).inputDefaults }
        : {}),
    }
  }
  private nodeName(node: FlowPlan['nodes'][number]) {
    return (node as any).name ?? (node.kind === 'cf-call' ? node.cfRef.cfId : node.kind)
  }
  private path(value: Json | undefined, path: string): Json {
    return path.split('.').reduce<any>((current, key) => current?.[key], value) ?? null
  }
  /** Evaluates a branch condition against the node input context. */
  private evaluate(expression: Json, input: Json): any {
    if (typeof expression === 'boolean' || typeof expression === 'number') return expression
    if (typeof expression === 'string')
      return expression === '$input' || expression === '$inputContext' ? input : expression
    if (expression && typeof expression === 'object' && !Array.isArray(expression)) {
      const op = expression as any
      if ('$eq' in op) return this.evaluate(op.$eq[0], input) === this.evaluate(op.$eq[1], input)
      if ('$and' in op) return op.$and.every((x: Json) => this.evaluate(x, input))
      if ('$or' in op) return op.$or.some((x: Json) => this.evaluate(x, input))
      if ('$get' in op) {
        const key = String(op.$get)
        const direct = this.path(input, key)
        if (direct !== null) return direct
        const context = input as any
        const flow = this.path(context?.flowInput, key)
        if (flow !== null) return flow
        for (const source of context?.upstream ?? []) {
          const value = this.path(source?.output, key)
          if (value !== null) return value
          if (source?.output && typeof source.output === 'object' && key in source.output)
            return source.output[key]
        }
        return null
      }
    }
    return expression
  }
}
export function builtins() {
  return new ExecutorRegistry()
    .register({
      id: 'echo',
      execute: async (task, input) => ({ task, input }),
    })
    .register({
      id: DEMO_RUNTIME_ID,
      execute: executeDemoCapability,
    })
}
export function newRunId() {
  return randomUUID()
}

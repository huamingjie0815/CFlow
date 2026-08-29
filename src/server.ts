#!/usr/bin/env node
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync } from 'node:fs'
import { sep } from 'node:path'
import { Store } from './db.js'
import { compileCF, compileFlow } from './compiler.js'
import { Engine, builtins, newRunId } from './engine.js'
import { RuntimeManager } from './runtime.js'
import { sha256 } from './hash.js'
import type {
  CFDraft,
  CFVersion,
  FlowCompilationSnapshot,
  FlowDraft,
  FlowEdge,
  FlowNode,
  Json,
  FlowPlan,
  ResolvedResource,
  ResourceProfile,
  RuntimeProfile,
  WorkspaceSettings,
} from './types.js'

export function createApp(store = new Store()) {
  const versions = () => store.list<CFVersion>('cf_versions')
  const flowCompilations = () => store.flowCompilations()
  const runtimes = new RuntimeManager(store)
  const testPlans = new Map<string, FlowPlan>()
  const testCatalogs = new Map<string, CFVersion[]>()
  const executorRegistry = builtins()
  runtimes.registerAll(executorRegistry)
  const engine = new Engine(store, executorRegistry, () => [
    ...versions(),
    ...[...testCatalogs.values()].flat(),
  ])
  const app = Fastify({ logger: true })
  const runtimePublicRoot = (() => {
    const currentDir = fileURLToPath(new URL('.', import.meta.url))
    if (currentDir.includes(`${sep}dist${sep}`))
      return fileURLToPath(new URL('../public', import.meta.url))
    const packaged = fileURLToPath(new URL('../dist/public/index.html', import.meta.url))
    return existsSync(packaged)
      ? fileURLToPath(new URL('../dist/public', import.meta.url))
      : fileURLToPath(new URL('../public', import.meta.url))
  })()
  const pinRuntimeProfiles = async (plan: FlowPlan, catalog: CFVersion[]) => {
    const nodes = await Promise.all(
      plan.nodes.map(async (node) => {
        if (node.kind !== 'cf-call') return node
        const version = catalog.find(
          (item) => item.cfId === node.cfRef.cfId && item.version === node.cfRef.version,
        )
        const runtimeId = node.executor ?? version?.draft.defaultExecutor ?? 'echo'
        const profile = runtimes.profile(runtimeId)
        if (!profile) throw new Error(`RUNTIME_NOT_FOUND:${runtimeId}`)
        const health = await runtimes.health(runtimeId)
        if (health.status !== 'available') throw new Error(`RUNTIME_UNAVAILABLE:${runtimeId}`)
        return {
          ...node,
          executor: runtimeId,
          executorProfile: { id: runtimeId, profileVersion: profile.profileVersion },
        }
      }),
    )
    const { planHash: _oldHash, ...body } = plan
    const pinned = { ...body, nodes }
    return { ...pinned, planHash: sha256(pinned) } as FlowPlan
  }
  const applyCompileRuntime = (draft: FlowDraft, runtimeId?: string): FlowDraft => {
    const selected = runtimeId?.trim()
    if (!selected) return draft
    return {
      ...draft,
      nodes: draft.nodes.map((node) =>
        node.kind === 'cf-call' && !node.executor ? { ...node, executor: selected } : node,
      ),
    }
  }
  const saveCompilationSnapshot = (
    mode: FlowCompilationSnapshot['mode'],
    flowDraft: FlowDraft,
    plan: FlowPlan,
    programs: CFVersion[],
    runId?: string,
  ) => {
    const snapshot: FlowCompilationSnapshot = {
      id: `${flowDraft.flowId}@${flowDraft.revision}:${mode}`,
      flowId: flowDraft.flowId,
      flowRevision: flowDraft.revision,
      mode,
      flowDraft,
      plan,
      programs,
      runId,
      createdAt: new Date().toISOString(),
    }
    store.saveFlowCompilation(snapshot)
    return snapshot
  }
  const resolveResources = (plan: FlowPlan, profileId?: string): ResolvedResource[] => {
    const requirements = plan.resources ?? []
    const profile = profileId ? store.getResourceProfile(profileId) : undefined
    if (profileId && !profile) throw new Error('RESOURCE_PROFILE_NOT_FOUND')
    const resolved: ResolvedResource[] = []
    for (const binding of profile?.bindings ?? []) {
      if (!requirements.some((requirement) => requirement.id === binding.requirementId))
        throw new Error(`RESOURCE_BINDING_UNKNOWN_REQUIREMENT:${binding.requirementId}`)
    }
    for (const requirement of requirements) {
      const matches =
        profile?.bindings.filter((binding) => binding.requirementId === requirement.id) ?? []
      if (matches.length > 1) throw new Error(`RESOURCE_BINDING_DUPLICATE:${requirement.id}`)
      const binding = matches[0]
      if (!binding) {
        if (requirement.required) throw new Error(`RESOURCE_BINDING_REQUIRED:${requirement.id}`)
        continue
      }
      if (binding.type !== requirement.type)
        throw new Error(`RESOURCE_TYPE_MISMATCH:${requirement.id}`)
      if (!binding.resourceId.trim()) throw new Error(`RESOURCE_ID_REQUIRED:${requirement.id}`)
      resolved.push({ ...binding, access: requirement.access, profileId: profile!.id })
    }
    return resolved
  }
  const proposalCapabilitySchema = {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'name', 'does', 'cfId'],
    properties: {
      kind: { type: 'string', enum: ['cf-call'] },
      name: { type: 'string' },
      does: { type: 'string' },
      cfId: { type: ['string', 'null'] },
    },
  } as const
  const proposalStageSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'name', 'does', 'cfId', 'cond', 'routes'],
    properties: {
      kind: { type: 'string', enum: ['cf-call', 'branch'] },
      name: { type: 'string' },
      does: { type: ['string', 'null'] },
      cfId: { type: ['string', 'null'] },
      cond: { type: ['string', 'null'] },
      routes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['caseId', 'condition', 'stages'],
          properties: {
            caseId: { type: 'string' },
            condition: { type: 'string' },
            stages: {
              type: 'array',
              minItems: 1,
              maxItems: 6,
              items: proposalCapabilitySchema,
            },
          },
        },
      },
    },
  } as const
  const flowProposalOutputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['flowName', 'summary', 'stages'],
    properties: {
      flowName: { type: 'string' },
      summary: { type: 'string' },
      stages: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: proposalStageSchema,
      },
    },
  } as const
  const flowAgentOutputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['message', 'actions'],
    properties: {
      message: { type: 'string' },
      actions: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'label', 'description', 'nodeId'],
          properties: {
            type: {
              type: 'string',
              enum: ['retry-node', 'select-node', 'open-activity', 'update-node', 'update-binding'],
            },
            label: { type: 'string' },
            description: { type: 'string' },
            nodeId: { type: ['string', 'null'] },
            patch: {
              type: 'object',
              additionalProperties: false,
              properties: {
                executor: { type: 'string' },
                onError: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['action'],
                  properties: {
                    action: { type: 'string', enum: ['stop', 'retry'] },
                    maxAttempts: { type: 'integer', minimum: 1, maximum: 5 },
                  },
                },
              },
            },
            binding: {
              type: 'object',
              additionalProperties: false,
              required: ['from', 'to'],
              properties: {
                id: { type: 'string' },
                from: { type: 'string' },
                to: { type: 'string' },
                required: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  } as const
  type AgentRequest = {
    message: string
    runtimeId?: string
    flowDraft: FlowDraft | null
    cfDrafts?: CFDraft[]
    runDetail?: {
      run?: { status?: string; flow_version_id?: string }
      events?: { type: string; node?: number; data?: Json; at?: string }[]
    } | null
  }
  type AgentAction = {
    type: 'retry-node' | 'select-node' | 'open-activity' | 'update-node' | 'update-binding'
    label: string
    description: string
    nodeId?: string
    patch?: {
      executor?: string
      onError?: { action: 'stop' | 'retry'; maxAttempts?: number }
    }
    binding?: { id?: string; from: string; to: string; required?: boolean }
  }
  const flowAgentFallback = (body: AgentRequest): { message: string; actions: AgentAction[] } => {
    const draft = body.flowDraft
    const events = body.runDetail?.events ?? []
    const failedEvent = [...events]
      .reverse()
      .find((event) => event.type === 'node.failed' || event.type === 'run.failed')
    const failedNode =
      draft && failedEvent?.node !== undefined ? draft.nodes[failedEvent.node] : undefined
    const error =
      failedEvent?.data && typeof failedEvent.data === 'object' && 'error' in failedEvent.data
        ? String(failedEvent.data.error)
        : '运行没有完成。'
    if (!draft)
      return {
        message: '目前还没有可分析的流程。先在中间区域描述目标，生成一份 Flow 草案后，我就能检查步骤和运行证据。',
        actions: [],
      }
    if (failedEvent) {
      const nodeLabel = failedNode?.id ?? '未知步骤'
      const actions: AgentAction[] = [
        {
          type: 'open-activity',
          label: '查看完整运行记录',
          description: '打开活动面板，按时间核对失败前后的事件。',
        },
      ]
      if (failedNode?.kind === 'cf-call')
        actions.unshift({
          type: 'retry-node',
          label: '为失败步骤增加重试',
          description: '应用 2 次重试策略，避免瞬时故障直接中断流程。',
          nodeId: failedNode.id,
        })
      return {
        message: `我定位到最近一次运行在「${nodeLabel}」失败。记录里的原因是：${error}。先确认这个步骤收到的输入是否完整；如果这是网络或服务瞬时错误，可以先加重试，再重新测试。`,
        actions,
      }
    }
    if (/优化|性能|简化|改进|检查/.test(body.message)) {
      const firstNode = draft.nodes.find((node) => node.kind === 'cf-call')
      return {
        message: `当前 Flow 有 ${draft.nodes.length} 个步骤和 ${draft.edges.length} 条连线。建议先从数据交接和失败策略入手：每个能力步骤都应明确输入、输出，并为可能的瞬时故障设置重试；确认后再做结构调整。`,
        actions: firstNode
          ? [
              {
                type: 'update-node',
                label: '为第一个能力步骤增加重试',
                description: '应用 2 次重试策略，先降低瞬时服务错误对流程的影响。',
                nodeId: firstNode.id,
                patch: { onError: { action: 'retry', maxAttempts: 2 } },
              },
            ]
          : [],
      }
    }
    return {
      message: `我已经加载「${draft.name}」第 ${draft.revision} 稿，当前有 ${draft.nodes.length} 个步骤。你可以继续描述想优化的目标，或贴出具体错误；我会结合流程结构和最近运行事件给出可应用的建议。`,
      actions: [],
    }
  }
  const normalizeAgentResponse = (value: unknown) => {
    const raw = value as { message?: unknown; actions?: unknown }
    const actions = Array.isArray(raw?.actions)
      ? raw.actions
          .map((action) => {
            const item = action as Record<string, unknown>
            const type = item.type
            if (
              ![
                'retry-node',
                'select-node',
                'open-activity',
                'update-node',
                'update-binding',
              ].includes(String(type))
            )
              return null
            const rawPatch = item.patch
            const patch =
              rawPatch && typeof rawPatch === 'object'
                ? (() => {
                    const value = rawPatch as Record<string, unknown>
                    const rawError = value.onError
                    const onError =
                      rawError && typeof rawError === 'object'
                        ? (() => {
                            const error = rawError as Record<string, unknown>
                            if (!['stop', 'retry'].includes(String(error.action))) return undefined
                            return {
                              action: error.action as 'stop' | 'retry',
                              ...(Number.isInteger(error.maxAttempts)
                                ? { maxAttempts: Math.min(5, Math.max(1, Number(error.maxAttempts))) }
                                : {}),
                            }
                          })()
                        : undefined
                    return {
                      ...(typeof value.executor === 'string' ? { executor: value.executor.slice(0, 80) } : {}),
                      ...(onError ? { onError } : {}),
                    }
                  })()
                : undefined
            const rawBinding = item.binding
            const binding =
              rawBinding && typeof rawBinding === 'object'
                ? (() => {
                    const value = rawBinding as Record<string, unknown>
                    const from = typeof value.from === 'string' ? value.from.trim() : ''
                    const to = typeof value.to === 'string' ? value.to.trim() : ''
                    return from && to
                      ? {
                          ...(typeof value.id === 'string' ? { id: value.id.slice(0, 120) } : {}),
                          from: from.slice(0, 240),
                          to: to.slice(0, 240),
                          ...(typeof value.required === 'boolean'
                            ? { required: value.required }
                            : {}),
                        }
                      : undefined
                  })()
                : undefined
            return {
              type: type as AgentAction['type'],
              label: String(item.label ?? '').slice(0, 80),
              description: String(item.description ?? '').slice(0, 220),
              ...(typeof item.nodeId === 'string' ? { nodeId: item.nodeId.slice(0, 120) } : {}),
              ...(patch && Object.keys(patch).length ? { patch } : {}),
              ...(binding ? { binding } : {}),
            }
          })
          .filter((action): action is AgentAction => Boolean(action?.label && action.description))
          .slice(0, 3)
      : []
    const message = String(raw?.message ?? '').trim().slice(0, 3000)
    if (!message) throw new Error('RUNTIME_AGENT_RESPONSE_INVALID')
    return { message, actions }
  }
  app.register(fastifyStatic, { root: runtimePublicRoot })
  app.get('/', async (_, reply) => reply.sendFile('index.html'))
  app.get('/api/settings', async () => runtimes.settings())
  app.put<{ Body: Partial<WorkspaceSettings> }>('/api/settings', async (req) =>
    runtimes.updateSettings(req.body ?? {}),
  )
  app.get('/api/runtimes', async () =>
    Promise.all(
      runtimes.profiles().map(async (profile) => ({
        ...profile,
        health: await runtimes.health(profile.id),
      })),
    ),
  )
  app.get<{ Params: { id: string } }>('/api/runtimes/:id', async (req, reply) => {
    const profile = runtimes.profile(req.params.id)
    if (!profile) return reply.code(404).send({ error: 'RUNTIME_NOT_FOUND' })
    return {
      ...profile,
      health: await runtimes.health(profile.id),
      history: store.runtimeProfileHistory(profile.id),
    }
  })
  app.post<{ Body: Partial<RuntimeProfile> & { id: string; name: string } }>(
    '/api/runtimes',
    async (req) => {
      const profile = runtimes.saveProfile(req.body)
      runtimes.register(executorRegistry, profile)
      return { ...profile, health: await runtimes.health(profile.id, true) }
    },
  )
  app.post<{ Params: { id: string } }>('/api/runtimes/:id/test', async (req, reply) => {
    if (!runtimes.profile(req.params.id))
      return reply.code(404).send({ error: 'RUNTIME_NOT_FOUND' })
    return runtimes.health(req.params.id, true)
  })
  app.get('/api/cfs', async () => store.list<CFVersion>('cf_versions'))
  app.get('/api/cf-drafts', async () => store.list<CFDraft>('cf_drafts'))
  app.get('/api/flow-compilations', async () => flowCompilations())
  app.put<{ Params: { id: string }; Body: CFDraft }>('/api/cf-drafts/:id', async (req) => {
    if (req.params.id !== req.body.cfId) throw new Error('CF_DRAFT_ID_MISMATCH')
    if (!req.body.cfId?.trim() || !req.body.name?.trim() || !req.body.does?.trim())
      throw new Error('CF_DRAFT_INVALID')
    store.save('cf_drafts', req.body.cfId, req.body)
    return req.body
  })
  app.post<{ Body: CFDraft }>('/api/cfs', async (req) => {
    const v = compileCF(req.body)
    store.save('cf_drafts', req.body.cfId, req.body)
    store.save('cf_versions', `${v.cfId}@${v.version}`, v)
    return v
  })
  app.get('/api/flows', async () => store.list<FlowPlan>('flow_versions'))
  app.get('/api/flow-drafts', async () => store.list<FlowDraft>('flow_drafts'))
  app.put<{ Params: { id: string }; Body: FlowDraft }>('/api/flow-drafts/:id', async (req) => {
    if (req.params.id !== req.body.flowId) throw new Error('FLOW_DRAFT_ID_MISMATCH')
    if (!req.body.flowId?.trim() || !req.body.name?.trim() || !req.body.objective?.trim())
      throw new Error('FLOW_DRAFT_INVALID')
    store.save('flow_drafts', req.body.flowId, req.body)
    return req.body
  })
  app.delete<{ Params: { id: string } }>('/api/flow-drafts/:id', async (req, reply) => {
    const result = store.db.prepare('DELETE FROM flow_drafts WHERE id=?').run(req.params.id) as {
      changes?: number
    }
    if (!result.changes) return reply.code(404).send({ error: 'FLOW_DRAFT_NOT_FOUND' })
    return { deleted: true }
  })
  app.post<{
    Body: { flowDraft: FlowDraft; cfDrafts?: CFDraft[]; runtimeId?: string }
  }>(
    '/api/flow-compilations',
    async (req) => {
      const candidates = (req.body.cfDrafts ?? []).map(compileCF)
      const catalog = new Map(
        [...versions(), ...candidates].map((version) => [
          `${version.cfId}@${version.version}`,
          version,
        ]),
      )
      const selectedDraft = applyCompileRuntime(req.body.flowDraft, req.body.runtimeId)
      const compiled = compileFlow(selectedDraft, catalog)
      const plan = req.body.runtimeId
        ? await pinRuntimeProfiles(compiled, [...versions(), ...candidates])
        : compiled
      saveCompilationSnapshot(
        'preview',
        selectedDraft,
        plan,
        [...versions(), ...candidates].filter((version) =>
          selectedDraft.nodes.some(
            (node) =>
              node.kind === 'cf-call' &&
              node.cfRef.cfId === version.cfId &&
              node.cfRef.version === version.version,
          ),
        ),
      )
      const referenced = new Set(
        selectedDraft.nodes
          .filter((node) => node.kind === 'cf-call')
          .map((node) => `${node.cfRef.cfId}@${node.cfRef.version}`),
      )
      return {
        plan,
        programs: [...catalog.values()].filter((version) =>
          referenced.has(`${version.cfId}@${version.version}`),
        ),
      }
    },
  )
  app.post<{ Body: { objective: string; runtimeId?: string } }>(
    '/api/flow-proposals',
    async (req) => {
    const objective = req.body.objective?.trim()
    if (!objective) throw new Error('OBJECTIVE_REQUIRED')
    const catalog = versions()
    const requestedRuntime = req.body.runtimeId?.trim()
    if (requestedRuntime && requestedRuntime !== 'echo') {
      const profile = runtimes.profile(requestedRuntime)
      if (!profile) throw new Error('RUNTIME_NOT_FOUND')
      const health = await runtimes.health(requestedRuntime)
      if (health.status !== 'available') throw new Error(`RUNTIME_UNAVAILABLE:${requestedRuntime}`)
      const response = await runtimes.execute(
        requestedRuntime,
        [
          'Design a concise, reviewable Flow for the supplied objective.',
          'Return JSON with this exact shape:',
          '{"flowName":"...","summary":"...","stages":[{"kind":"cf-call","name":"...","does":"...","cfId":null,"cond":null,"routes":[]}]}',
          'Use 2-6 stages. A cfId may only be copied exactly from the supplied catalog. Use null when no published capability fits.',
          'Each stage must be one reusable bounded capability, not an entire dynamic workflow.',
          'For every cf-call stage, set cond to null and routes to an empty array.',
          'When the objective contains conditional work, emit a stage with kind "branch" instead of forcing true/false. Its shape is {"kind":"branch","name":"...","does":null,"cfId":null,"cond":"the result field or expression to inspect","routes":[{"caseId":"stable-kebab-id","condition":"natural-language condition","stages":[{"kind":"cf-call","name":"...","does":"...","cfId":null}]}]}.',
          'A branch may have any number of routes (2 or more). Every route needs a unique stable caseId, an explicit natural-language condition, and one or more follow-up stages. The generated Flow and compiled DSL must preserve these route conditions and case IDs.',
          'The branch cond value must identify the input/result field that yields one of those caseIds at runtime; never assume a hard-coded true/false result.',
        ].join('\n'),
        {
          objective,
          catalog: catalog.slice(0, 80).map((version) => ({
            cfId: version.cfId,
            version: version.version,
            name: version.draft.name,
            does: version.draft.does,
          })),
        },
        AbortSignal.timeout(runtimes.settings().testTimeoutMs),
        [],
        flowProposalOutputSchema,
      )
      const proposal = response as any
      if (!proposal || typeof proposal !== 'object' || !Array.isArray(proposal.stages))
        throw new Error('RUNTIME_PROPOSAL_INVALID')
      const branchStage = proposal.stages.find((stage: any) => stage?.kind === 'branch')
      if (branchStage) {
        const stages = proposal.stages.slice(0, 6)
        const token = Date.now().toString(36)
        const cfDrafts: CFDraft[] = []
        const nodes: FlowNode[] = []
        const edges: FlowEdge[] = []
        const makeCapability = (stage: any, index: number): FlowNode => {
          const name = String(stage?.name ?? '').trim().slice(0, 80)
          const does = String(stage?.does ?? '').trim().slice(0, 500)
          if (!name || !does) throw new Error(`RUNTIME_PROPOSAL_STAGE_INVALID:${index}`)
          const match = stage.cfId
            ? catalog.find((version) => version.cfId === String(stage.cfId))
            : undefined
          if (match)
            return {
              id: `step-${nodes.length + 1}`,
              kind: 'cf-call',
              cfRef: { cfId: match.cfId, version: match.version },
              executor: requestedRuntime,
            }
          const cfId = `cf-${token}-${cfDrafts.length + 1}`
          cfDrafts.push({
            cfId,
            revision: 1,
            name,
            does,
            input: '来自 Flow 输入或上游 CF 的结构化输入',
            output: '供下游 CF 使用的结构化结果',
            inputContract: { type: 'object' },
            outputContract: { type: 'object' },
            defaultExecutor: requestedRuntime,
          })
          return {
            id: `step-${nodes.length + 1}`,
            kind: 'cf-call',
            cfRef: { cfId, version: '1.0.0' },
            executor: requestedRuntime,
          }
        }
        const connect = (from: string | '$entry', to: string, when?: FlowEdge['when']) => {
          edges.push({ id: `edge-${edges.length + 1}`, from, to, ...(when ? { when } : {}) })
        }
        const first = stages.findIndex((stage: any) => stage?.kind === 'branch')
        let previous: string | '$entry' = '$entry'
        for (let i = 0; i < first; i += 1) {
          const node = makeCapability(stages[i], i)
          nodes.push(node)
          connect(previous, node.id)
          previous = node.id
        }
        const routes = Array.isArray(branchStage.routes) ? branchStage.routes.slice(0, 8) : []
        if (routes.length < 2) throw new Error('RUNTIME_PROPOSAL_BRANCH_ROUTES_INVALID')
        const cases: string[] = []
        const caseConditions: Record<string, string> = {}
        const branch: FlowNode = {
          id: `branch-${first + 1}`,
          kind: 'branch',
          cond: { $get: String(branchStage.cond ?? 'route').trim() || 'route' },
          cases,
          caseConditions,
        }
        nodes.push(branch)
        connect(previous, branch.id)
        const routeEnds: string[] = []
        routes.forEach((route: any, routeIndex: number) => {
          const caseId = String(route?.caseId ?? `case-${routeIndex + 1}`).trim()
          const condition = String(route?.condition ?? '').trim().slice(0, 500)
          if (!caseId || !condition || cases.includes(caseId)) throw new Error('RUNTIME_PROPOSAL_BRANCH_CASE_INVALID')
          cases.push(caseId)
          caseConditions[caseId] = condition
          const routeStages = Array.isArray(route?.stages) ? route.stages.slice(0, 6) : []
          if (!routeStages.length) throw new Error('RUNTIME_PROPOSAL_BRANCH_ROUTE_EMPTY')
          let routePrevious: string = branch.id
          routeStages.forEach((stage: any, stageIndex: number) => {
            const node = makeCapability(stage, stageIndex)
            nodes.push(node)
            connect(routePrevious, node.id, stageIndex === 0 ? { outcome: 'branch-case', caseId } : undefined)
            routePrevious = node.id
          })
          routeEnds.push(routePrevious)
        })
        let downstreamEnds = routeEnds
        for (let stageIndex = first + 1; stageIndex < stages.length; stageIndex += 1) {
          const node = makeCapability(stages[stageIndex], stageIndex)
          nodes.push(node)
          downstreamEnds.forEach((routeEnd) => {
            connect(routeEnd, node.id)
          })
          downstreamEnds = [node.id]
        }
        const output: FlowNode = { id: 'output', kind: 'output', outputId: 'result' }
        nodes.push(output)
        downstreamEnds.forEach((routeEnd) => {
          connect(routeEnd, output.id)
        })
        return {
          objective,
          runtimeId: requestedRuntime,
          assistantMessage: String(proposal.summary ?? 'Runtime 已生成包含多条件分支的 Flow 草案。').slice(0, 1000),
          cfDrafts,
          flowDraft: {
            flowId: `proposal-${Date.now()}`,
            revision: 1,
            name: String(proposal.flowName ?? objective).slice(0, 80),
            objective,
            nodes,
            edges,
          },
          unresolvedSuggestions: cfDrafts.map((draft) => `PROPOSED_CF:${draft.cfId}`),
        }
      }
      const stages = proposal.stages.slice(0, 6).map((stage: any, index: number) => {
        const name = String(stage?.name ?? '').trim().slice(0, 80)
        const does = String(stage?.does ?? '').trim().slice(0, 500)
        if (!name || !does) throw new Error(`RUNTIME_PROPOSAL_STAGE_INVALID:${index}`)
        const match = stage.cfId
          ? catalog.find((version) => version.cfId === String(stage.cfId))
          : undefined
        return { name, does, match }
      })
      if (stages.length < 1) throw new Error('RUNTIME_PROPOSAL_EMPTY')
      const token = Date.now().toString(36)
      const cfDrafts: CFDraft[] = []
      const nodes = stages.map((stage: (typeof stages)[number], index: number) => {
        if (stage.match)
          return {
            id: `step-${index + 1}`,
            kind: 'cf-call' as const,
            cfRef: { cfId: stage.match.cfId, version: stage.match.version },
            executor: requestedRuntime,
          }
        const cfId = `cf-${token}-${index + 1}`
        cfDrafts.push({
          cfId,
          revision: 1,
          name: stage.name,
          does: stage.does,
          input: '来自 Flow 输入或上游 CF 的结构化输入',
          output: '供下游 CF 使用的结构化结果',
          inputContract: { type: 'object' },
          outputContract: { type: 'object' },
          defaultExecutor: requestedRuntime,
        })
        return {
          id: `step-${index + 1}`,
          kind: 'cf-call' as const,
          cfRef: { cfId, version: '1.0.0' },
          executor: requestedRuntime,
        }
      })
      const output = { id: 'output', kind: 'output' as const, outputId: 'result' }
      const edges: FlowEdge[] = [
        { id: 'entry', from: '$entry', to: nodes[0].id },
        ...nodes.slice(0, -1).map((node: { id: string }, index: number) => ({
          id: `edge-${index + 1}`,
          from: node.id,
          to: nodes[index + 1].id,
        })),
        { id: 'finish', from: nodes[nodes.length - 1].id, to: output.id },
      ]
      return {
        objective,
        runtimeId: requestedRuntime,
        assistantMessage: String(proposal.summary ?? 'Runtime 已生成可审阅的 Flow 草案。').slice(
          0,
          1000,
        ),
        cfDrafts,
        flowDraft: {
          flowId: `proposal-${Date.now()}`,
          revision: 1,
          name: String(proposal.flowName ?? objective).slice(0, 80),
          objective,
          nodes: [...nodes, output],
          edges,
        },
        unresolvedSuggestions: cfDrafts.map((draft) => `PROPOSED_CF:${draft.cfId}`),
      }
    }
    const terms = new Set(objective.toLowerCase().split(/\s+/))
    const selected = catalog
      .map((version) => ({
        version,
        score: [version.draft.name, version.draft.does]
          .join(' ')
          .toLowerCase()
          .split(/\s+/)
          .filter((term) => terms.has(term)).length,
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((item) => item.version)
    if (!selected.length)
      return { objective, flowDraft: null, unresolvedSuggestions: ['NO_PUBLISHED_CF_MATCH'] }
    const nodes = selected.map((version, index) => ({
      id: `step-${index + 1}`,
      kind: 'cf-call' as const,
      cfRef: { cfId: version.cfId, version: version.version },
    }))
    const output = { id: 'output', kind: 'output' as const, outputId: 'result' }
    const edges: FlowEdge[] = [
      { id: 'entry', from: '$entry', to: nodes[0].id },
      ...nodes.slice(0, -1).map((node, index) => ({
        id: `edge-${index + 1}`,
        from: node.id,
        to: nodes[index + 1].id,
      })),
      { id: 'finish', from: nodes[nodes.length - 1].id, to: output.id },
    ]
    return {
      objective,
      flowDraft: {
        flowId: `proposal-${Date.now()}`,
        revision: 1,
        name: objective.slice(0, 80),
        objective,
        nodes: [...nodes, output],
        edges,
      },
      unresolvedSuggestions: [],
    }
    },
  )
  app.post<{ Body: AgentRequest }>('/api/flow-agent/chat', async (req) => {
    const message = req.body.message?.trim()
    if (!message) throw new Error('AGENT_MESSAGE_REQUIRED')
    const fallback = flowAgentFallback({ ...req.body, message })
    const requestedRuntime = req.body.runtimeId?.trim() || runtimes.settings().defaultRuntimeId
    const profile = requestedRuntime ? runtimes.profile(requestedRuntime) : undefined
    if (!profile || profile.backend === 'builtin') return { ...fallback, fallback: true }
    const health = await runtimes.health(requestedRuntime)
    if (health.status !== 'available') return { ...fallback, fallback: true }
    const draftSummary = req.body.flowDraft
      ? {
          flowId: req.body.flowDraft.flowId,
          name: req.body.flowDraft.name,
          revision: req.body.flowDraft.revision,
          objective: req.body.flowDraft.objective,
          nodes: req.body.flowDraft.nodes.map((node) => ({
            id: node.id,
            kind: node.kind,
            ...(node.kind === 'cf-call'
              ? {
                  capability: node.cfRef,
                  executor: node.executor,
                  onError: node.onError,
                }
              : {}),
          })),
          edges: req.body.flowDraft.edges,
        }
      : null
    const runSummary = req.body.runDetail
      ? {
          run: req.body.runDetail.run,
          events: (req.body.runDetail.events ?? []).slice(-24),
        }
      : null
    const response = await runtimes.execute(
      requestedRuntime,
      [
        'You are a Flow reliability advisor inside a visual workflow editor.',
        'Analyze the user request using the supplied current Flow and run evidence.',
        'Do not rewrite the Flow directly. Return concise Chinese guidance and at most three reviewable actions.',
        'Only suggest retry-node or update-node for a real cf-call node id. Use update-binding only with exact existing Flow node ids and field paths. Use select-node to focus an existing node. Use open-activity to point to runtime evidence.',
        'update-node may only change executor to an exact supplied runtime id, or onError to {"action":"stop"} / {"action":"retry","maxAttempts":1-5}.',
        'update-binding changes one input/output mapping and must use {"binding":{"from":"source.output","to":"target.input"}}. If you identify a concrete mapping fix, return update-binding so the user can apply it; do not return only select-node or open-activity. For requests such as 校准、修复、应用、修改配置, prefer an update-node or update-binding action whenever the exact change is clear.',
        'Return JSON with exactly this shape: {"message":"...","actions":[{"type":"retry-node|select-node|open-activity|update-node|update-binding","label":"...","description":"...","nodeId":null,"patch":{},"binding":{"from":"","to":""}}]}',
        `User request:\n${message}`,
      ].join('\n\n'),
      {
        flow: draftSummary,
        run: runSummary,
        cfDrafts: req.body.cfDrafts ?? [],
        runtimes: runtimes.profiles().map((item) => ({ id: item.id, name: item.name })),
      } as unknown as Json,
      AbortSignal.timeout(runtimes.settings().testTimeoutMs),
      [],
      flowAgentOutputSchema,
    )
    return { ...normalizeAgentResponse(response), runtimeId: requestedRuntime }
  })
  app.get('/api/runs', async () => store.runs())
  app.get('/api/resources', async () => store.resourceProfiles<ResourceProfile>())
  app.post<{ Body: ResourceProfile }>('/api/resources', async (req) => {
    if (!req.body.id?.trim() || !req.body.name?.trim() || !Array.isArray(req.body.bindings))
      throw new Error('RESOURCE_PROFILE_INVALID')
    const ids = new Set<string>()
    for (const binding of req.body.bindings) {
      if (!binding.requirementId?.trim() || !binding.resourceId?.trim() || !binding.type?.trim())
        throw new Error('RESOURCE_BINDING_INVALID')
      if (ids.has(binding.requirementId))
        throw new Error(`RESOURCE_BINDING_DUPLICATE:${binding.requirementId}`)
      ids.add(binding.requirementId)
    }
    store.saveResourceProfile(req.body.id, req.body)
    return req.body
  })
  app.delete<{ Params: { id: string } }>('/api/resources/:id', async (req, reply) => {
    const result = store.deleteResourceProfile(req.params.id)
    if (!result.changes) return reply.code(404).send({ error: 'RESOURCE_PROFILE_NOT_FOUND' })
    const settings = runtimes.settings()
    if (settings.defaultResourceProfileId === req.params.id)
      runtimes.updateSettings({ defaultResourceProfileId: undefined })
    return { deleted: true }
  })
  app.post<{ Body: FlowDraft }>('/api/flows', async (req) => {
    const catalog = versions()
    const plan = await pinRuntimeProfiles(
      compileFlow(
        req.body,
        new Map(catalog.map((v) => [`${v.cfId}@${v.version}`, v])),
      ),
      catalog,
    )
    store.save('flow_drafts', req.body.flowId, req.body)
    store.save('flow_versions', `${plan.flowId}@${plan.flowVersion}`, plan)
    return plan
  })
  app.post<{
    Body: {
      flowDraft: FlowDraft
      cfDrafts?: CFDraft[]
      input?: unknown
      resourceProfileId?: string
      runtimeId?: string
    }
  }>('/api/flow-tests', async (req) => {
    const candidateVersions = (req.body.cfDrafts ?? []).map(compileCF)
    const catalog = new Map(
      [...versions(), ...candidateVersions].map((version) => [
        `${version.cfId}@${version.version}`,
        version,
      ]),
    )
    const selectedDraft = applyCompileRuntime(req.body.flowDraft, req.body.runtimeId)
    const compiled = compileFlow(selectedDraft, catalog)
    const plan = await pinRuntimeProfiles(compiled, [
      ...versions(),
      ...candidateVersions,
    ])
    const programs = [...versions(), ...candidateVersions].filter((version) =>
      selectedDraft.nodes.some(
        (node) =>
          node.kind === 'cf-call' &&
          node.cfRef.cfId === version.cfId &&
          node.cfRef.version === version.version,
      ),
    )
    const resources = resolveResources(plan, req.body.resourceProfileId)
    const id = newRunId()
    const flowVersionId = `test:${id}`
    testPlans.set(flowVersionId, plan)
    testCatalogs.set(flowVersionId, candidateVersions)
    saveCompilationSnapshot('test', selectedDraft, plan, programs, id)
    store.createRun(
      id,
      flowVersionId,
      (req.body.input as any) ?? {},
      resources,
      req.body.resourceProfileId,
    )
    engine.start(id, plan)
    return {
      runId: id,
      test: true,
      plan,
      programs,
    }
  })
  app.post<{
    Body: { flowId: string; flowVersion: string; input?: unknown; resourceProfileId?: string }
  }>('/api/runs', async (req) => {
    const plan = store.get<FlowPlan>('flow_versions', `${req.body.flowId}@${req.body.flowVersion}`)
    if (!plan) throw new Error('FLOW_VERSION_NOT_FOUND')
    const resources = resolveResources(plan, req.body.resourceProfileId)
    const id = newRunId()
    store.createRun(
      id,
      `${plan.flowId}@${plan.flowVersion}`,
      (req.body.input as any) ?? {},
      resources,
      req.body.resourceProfileId,
    )
    engine.start(id, plan)
    return { runId: id }
  })
  app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', async (req, reply) => {
    if (!engine.cancel(req.params.id)) return reply.code(409).send({ error: 'RUN_NOT_RUNNING' })
    return { cancelled: true }
  })
  app.post<{ Params: { id: string; node: string }; Body: { decision: 'approved' | 'rejected' } }>(
    '/api/runs/:id/approvals/:node',
    async (req, reply) => {
      if (!['approved', 'rejected'].includes(req.body.decision))
        return reply.code(400).send({ error: 'APPROVAL_DECISION_INVALID' })
      const run = store.getRun(req.params.id)
      if (!run) return reply.code(404).send({ error: 'RUN_NOT_FOUND' })
      const node = Number(req.params.node)
      const plan =
        testPlans.get(run.flow_version_id) ??
        store.get<FlowPlan>('flow_versions', run.flow_version_id)
      if (
        !Number.isInteger(node) ||
        !plan?.nodes.some((item) => item.index === node && item.kind === 'approval')
      ) {
        return reply.code(400).send({ error: 'APPROVAL_NODE_INVALID' })
      }
      if (run.status !== 'waiting-approval')
        return reply.code(409).send({ error: 'RUN_NOT_WAITING_APPROVAL' })
      store.decideApproval(req.params.id, node, req.body.decision)
      if (plan) engine.start(req.params.id, plan)
      return { runId: req.params.id, node, decision: req.body.decision }
    },
  )
  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const run = store.getRun(req.params.id)
    if (!run) return reply.code(404).send({ error: 'RUN_NOT_FOUND' })
    return { run, events: store.events(req.params.id) }
  })
  app.get<{ Params: { id: string } }>('/api/runs/:id/events', async (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    let sent = Number(req.headers['last-event-id'] ?? 0)
    const timer = setInterval(() => {
      const events = store.events(req.params.id)
      for (const e of events.filter((event) => event.seq > sent)) {
        reply.raw.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`)
        sent = e.seq
      }
      const run = store.getRun(req.params.id)
      if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) {
        clearInterval(timer)
        reply.raw.end()
      }
    }, 100)
    req.raw.on('close', () => clearInterval(timer))
  })
  app.setErrorHandler((e, _r, reply) =>
    reply.code(400).send({ error: e instanceof Error ? e.message : String(e) }),
  )
  const recover = setInterval(() => {
    const job = store.claimJob()
    if (!job) return
    const run = store.getRun(job.runId)
    if (!run) return
    const plan =
      testPlans.get(run.flow_version_id) ?? store.get<FlowPlan>('flow_versions', run.flow_version_id)
    if (plan) engine.start(job.runId, plan)
  }, 250)
  app.addHook('onClose', async () => clearInterval(recover))
  return app
}

if (process.argv[1]?.endsWith('/server.js') || process.argv[1]?.endsWith('/server.ts')) {
  mkdirSync('./data', { recursive: true })
  const app = createApp()
  await app.listen({
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 3000),
  })
}

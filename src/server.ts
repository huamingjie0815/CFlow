import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { Store } from './db.js'
import { compileCF, compileFlow } from './compiler.js'
import { Engine, builtins, newRunId } from './engine.js'
import { RuntimeManager } from './runtime.js'
import { sha256 } from './hash.js'
import type {
  CFDraft,
  CFVersion,
  FlowDraft,
  FlowEdge,
  FlowPlan,
  ResolvedResource,
  ResourceProfile,
  RuntimeProfile,
  WorkspaceSettings,
} from './types.js'

export function createApp(store = new Store()) {
  const versions = () => store.list<CFVersion>('cf_versions')
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
  app.register(fastifyStatic, { root: join(process.cwd(), 'public') })
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
          '{"flowName":"...","summary":"...","stages":[{"name":"...","does":"...","cfId":"optional exact catalog id"}]}',
          'Use 2-6 stages. A cfId may only be copied exactly from the supplied catalog. Omit cfId when no published capability fits.',
          'Each stage must be one reusable bounded capability, not an entire dynamic workflow.',
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
      )
      const proposal = response as any
      if (!proposal || typeof proposal !== 'object' || !Array.isArray(proposal.stages))
        throw new Error('RUNTIME_PROPOSAL_INVALID')
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
          bindings: [
            { id: 'initial-input', from: '$user.input', to: nodes[0].id + '.input' },
            ...nodes.slice(1).map((node: { id: string }, index: number) => ({
              id: `binding-${index + 1}`,
              from: nodes[index].id + '.output',
              to: node.id + '.input',
            })),
            { id: 'result', from: nodes[nodes.length - 1].id + '.output', to: 'output.input' },
          ],
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
        bindings: [
          { id: 'initial-input', from: '$user.input', to: nodes[0].id + '.input' },
          ...nodes.slice(1).map((node, index) => ({
            id: `binding-${index + 1}`,
            from: nodes[index].id + '.output',
            to: node.id + '.input',
          })),
          { id: 'result', from: nodes[nodes.length - 1].id + '.output', to: 'output.input' },
        ],
      },
      unresolvedSuggestions: [],
    }
    },
  )
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
    }
  }>('/api/flow-tests', async (req) => {
    const candidateVersions = (req.body.cfDrafts ?? []).map(compileCF)
    const catalog = new Map(
      [...versions(), ...candidateVersions].map((version) => [
        `${version.cfId}@${version.version}`,
        version,
      ]),
    )
    const plan = await pinRuntimeProfiles(compileFlow(req.body.flowDraft, catalog), [
      ...versions(),
      ...candidateVersions,
    ])
    const resources = resolveResources(plan, req.body.resourceProfileId)
    const id = newRunId()
    const flowVersionId = `test:${id}`
    testPlans.set(flowVersionId, plan)
    testCatalogs.set(flowVersionId, candidateVersions)
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
      plan: {
        flowId: plan.flowId,
        flowVersion: plan.flowVersion,
        planHash: plan.planHash,
        nodeCount: plan.nodes.length,
      },
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
    return { ...run, events: store.events(req.params.id) }
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

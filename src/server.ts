#!/usr/bin/env node
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyMultipart from '@fastify/multipart'
import { fileURLToPath } from 'node:url'
import { constants, existsSync, mkdirSync, realpathSync } from 'node:fs'
import { cp, mkdir, readdir, realpath, rm, stat, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { Store } from './db.js'
import { compileCF, compileFlow } from './compiler.js'
import { Engine, builtins, newRunId } from './engine.js'
import { RuntimeManager } from './runtime.js'
import { sha256 } from './hash.js'
import { requireWorkspaceRoot, validateWorkspaceRoot } from './workspace.js'
import {
  collectGroundingFailures,
  groundingError,
  assertAttachmentGrounding,
  applyFlowRevision,
  buildProposalGraph,
  flowProposalOutputSchema,
  flowProposalPrompt,
  matchPublishedCapabilities,
  prepareSkillAttachments,
  type PreparedAttachments,
  type ProposalGraph,
} from './proposal.js'
import {
  flowAgentContext,
  flowAgentFallback,
  flowAgentOutputSchema,
  flowAgentPrompt,
  normalizeAgentResponse,
  type AgentRequest,
} from './flow-agent.js'
import type {
  CFDraft,
  CFVersion,
  FlowCompilationSnapshot,
  FlowDraft,
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
  const storedFlowWorkspace = (flowId: string) => {
    const draft = store.get<FlowDraft>('flow_drafts', flowId)
    if (draft) return requireWorkspaceRoot(draft.workspaceRoot)
    const plan = store.list<FlowPlan>('flow_versions').find((value) => value.flowId === flowId)
    return plan ? requireWorkspaceRoot(plan.workspaceRoot) : undefined
  }
  const assertFlowWorkspaceImmutable = (draft: FlowDraft) => {
    const requested = requireWorkspaceRoot(draft.workspaceRoot)
    const stored = storedFlowWorkspace(draft.flowId)
    if (stored !== undefined && stored !== requested) {
      try {
        if (validateWorkspaceRoot(requested) !== stored) throw new Error('FLOW_WORKSPACE_IMMUTABLE')
      } catch {
        throw new Error('FLOW_WORKSPACE_IMMUTABLE')
      }
    }
    return stored ?? requested
  }
  const operationalWorkspace = (draft: FlowDraft) => {
    const requested = assertFlowWorkspaceImmutable(draft)
    const normalized = validateWorkspaceRoot(requested)
    if (normalized !== requested) throw new Error('FLOW_WORKSPACE_IMMUTABLE')
    return normalized
  }
  const normalizeNewFlowWorkspace = (draft: FlowDraft): FlowDraft => {
    const stored = storedFlowWorkspace(draft.flowId)
    if (stored) {
      assertFlowWorkspaceImmutable(draft)
      return draft
    }
    return { ...draft, workspaceRoot: validateWorkspaceRoot(draft.workspaceRoot) }
  }
  const app = Fastify({ logger: true })
  app.register(fastifyMultipart, {
    // Do not silently truncate large skill bundles; files are streamed to disk.
    // Keep only structural parser guards here, while runtime timeout/output limits
    // remain the semantic protection for analysis requests.
    limits: { fileSize: Number.MAX_SAFE_INTEGER, files: 10_000, parts: 10_000 },
  })
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
        const runtimeId =
          node.executor ?? version?.draft.defaultExecutor ?? runtimes.settings().defaultRuntimeId
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
  const persistFlowProposal = async <
    T extends { flowDraft: FlowDraft | null; attachmentSummary?: any },
  >(
    proposal: T,
    attachments: PreparedAttachments | null,
  ): Promise<T> => {
    if (!proposal.flowDraft) {
      if (attachments) await rm(attachments.root, { recursive: true, force: true })
      return proposal
    }
    const draft = normalizeNewFlowWorkspace(proposal.flowDraft)
    let archivePath: string | undefined
    if (attachments) {
      archivePath = join('.cflow', 'flows', draft.flowId, 'attachments')
      const namespace = join(draft.workspaceRoot, '.cflow', 'flows', draft.flowId)
      try {
        await mkdir(dirname(join(draft.workspaceRoot, archivePath)), { recursive: true })
        await cp(attachments.root, join(draft.workspaceRoot, archivePath), {
          recursive: true,
          force: false,
          errorOnExist: true,
        })
      } catch (error) {
        await rm(namespace, { recursive: true, force: true })
        throw error
      } finally {
        await rm(attachments.root, { recursive: true, force: true })
      }
    }
    store.save('flow_drafts', draft.flowId, draft)
    return {
      ...proposal,
      flowDraft: draft,
      ...(proposal.attachmentSummary && archivePath
        ? { attachmentSummary: { ...proposal.attachmentSummary, archivePath } }
        : {}),
    }
  }
  app.register(fastifyStatic, { root: runtimePublicRoot })
  app.get('/', async (_, reply) => reply.sendFile('index.html'))
  app.get('/api/settings', async () => runtimes.settings())
  app.put<{ Body: Partial<WorkspaceSettings> }>('/api/settings', async (req) =>
    runtimes.updateSettings(req.body ?? {}),
  )
  app.get<{ Querystring: { path?: string } }>('/api/directories', async (req) => {
    const requested = req.query.path?.trim() || homedir()
    if (!isAbsolute(requested)) throw new Error('DIRECTORY_PATH_NOT_ABSOLUTE')
    let path: string
    try {
      path = await realpath(requested)
      if (!(await stat(path)).isDirectory()) throw new Error('DIRECTORY_NOT_FOUND')
      await access(path, constants.R_OK)
    } catch {
      throw new Error('DIRECTORY_NOT_READABLE')
    }
    const children = await readdir(path, { withFileTypes: true })
    const directories = (
      await Promise.all(
        children.map(async (entry) => {
          const candidate = join(path, entry.name)
          try {
            const normalized = await realpath(candidate)
            if (!(await stat(normalized)).isDirectory()) return null
            await access(normalized, constants.R_OK)
            // Flag dotfiles so the picker can hide developer directories by default.
            return { name: entry.name, path: normalized, hidden: entry.name.startsWith('.') }
          } catch {
            return null
          }
        }),
      )
    )
      .filter((entry): entry is { name: string; path: string; hidden: boolean } => Boolean(entry))
      .sort((a, b) => a.name.localeCompare(b.name))
    const parentCandidate = dirname(path)
    return {
      path,
      parentPath: parentCandidate === path ? null : await realpath(parentCandidate),
      directories,
    }
  })
  app.post<{ Body: { path?: string } }>('/api/directories/validate', async (req) => ({
    path: validateWorkspaceRoot(req.body?.path, 'DIRECTORY_NOT_READ_WRITE'),
  }))
  const runtimeCatalog = () =>
    Promise.all(
      runtimes.profiles().map(async (profile) => ({
        ...profile,
        health: await runtimes.health(profile.id),
      })),
    )
  app.get('/api/runtimes', runtimeCatalog)
  app.post('/api/runtimes/discover', async () => {
    for (const profile of runtimes.discover()) runtimes.register(executorRegistry, profile)
    return { runtimes: await runtimeCatalog(), warnings: runtimes.discoveryWarnings() }
  })
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
      return { ...profile, health: await runtimes.health(profile.id) }
    },
  )
  app.post<{ Params: { id: string } }>('/api/runtimes/:id/test', async (req, reply) => {
    if (!runtimes.profile(req.params.id))
      return reply.code(404).send({ error: 'RUNTIME_NOT_FOUND' })
    return runtimes.health(req.params.id)
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
    const draft = normalizeNewFlowWorkspace(req.body)
    store.save('flow_drafts', draft.flowId, draft)
    return draft
  })
  app.delete<{ Params: { id: string } }>('/api/flow-drafts/:id', async (req, reply) => {
    const result = store.db.prepare('DELETE FROM flow_drafts WHERE id=?').run(req.params.id) as {
      changes?: number
    }
    if (!result.changes) return reply.code(404).send({ error: 'FLOW_DRAFT_NOT_FOUND' })
    return { deleted: true }
  })
  const deletePublishedFlow = async (id: string, reply: any) => {
    const exact = store.deleteFlowVersion(id)
    const result = exact.changes ? exact : store.deleteFlowVersions(id)
    if (!result.changes) return reply.code(404).send({ error: 'FLOW_VERSION_NOT_FOUND' })
    return { deleted: true }
  }
  app.delete<{ Params: { id: string } }>('/api/flows/:id', async (req, reply) =>
    deletePublishedFlow(req.params.id, reply),
  )
  app.delete<{ Params: { flowId: string; flowVersion: string } }>(
    '/api/flows/:flowId/:flowVersion',
    async (req, reply) =>
      deletePublishedFlow(`${req.params.flowId}@${req.params.flowVersion}`, reply),
  )
  app.post<{
    Body: { flowDraft: FlowDraft; cfDrafts?: CFDraft[]; runtimeId?: string }
  }>('/api/flow-compilations', async (req) => {
    assertFlowWorkspaceImmutable(req.body.flowDraft)
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
  })
  app.post<{ Body: { objective: string; runtimeId?: string; workspaceRoot: string } }>(
    '/api/flow-proposals',
    async (req) => {
      const multipart =
        typeof (req as any).isMultipart === 'function' && (req as any).isMultipart()
          ? await prepareSkillAttachments(req as any)
          : null
      const discard = async () => {
        if (multipart) await rm(multipart.root, { recursive: true, force: true })
      }
      const failing = async (code: string) => {
        await discard()
        return new Error(code)
      }
      const body = multipart?.fields ?? (req.body as any)
      const workspaceRoot = validateWorkspaceRoot(body.workspaceRoot, 'FLOW_WORKSPACE_UNAVAILABLE')
      const objective = String(body.objective ?? '').trim()
      if (!objective) throw await failing('OBJECTIVE_REQUIRED')
      const catalog = versions()
      const runtimeId = body.runtimeId?.trim()
      const profile = runtimeId ? runtimes.profile(runtimeId) : undefined
      const runtimeUsable = Boolean(runtimeId) && profile?.backend !== 'builtin'
      // Attachment analysis needs a real agent runtime; the keyword fallback
      // below can only match already published capabilities.
      if (multipart && !runtimeUsable) throw await failing('RUNTIME_ANALYSIS_REQUIRED')

      const summary = multipart
        ? {
            attachmentSummary: {
              fileCount: multipart.files.length,
              skippedCount: multipart.skippedCount,
              entryFiles: multipart.entryFiles,
            },
          }
        : {}
      const asProposal = (
        graph: ProposalGraph,
        name: string,
        assistantMessage?: string,
        extra: object = {},
      ) =>
        persistFlowProposal(
          {
            objective,
            ...(runtimeUsable ? { runtimeId } : {}),
            ...(assistantMessage ? { assistantMessage } : {}),
            cfDrafts: graph.cfDrafts,
            flowDraft: {
              flowId: `proposal-${Date.now()}`,
              revision: 1,
              name: name.slice(0, 80),
              objective,
              workspaceRoot,
              nodes: graph.nodes,
              edges: graph.edges,
            },
            unresolvedSuggestions: graph.cfDrafts.map((draft) => `PROPOSED_CF:${draft.cfId}`),
            ...summary,
            ...extra,
          },
          multipart,
        )

      if (runtimeUsable) {
        if (!profile) throw await failing('RUNTIME_NOT_FOUND')
        const health = await runtimes.health(runtimeId!)
        if (health.status !== 'available') throw await failing(`RUNTIME_UNAVAILABLE:${runtimeId}`)
        const prompt = flowProposalPrompt(Boolean(multipart))
        const input = {
          objective,
          ...(multipart
            ? {
                attachments: {
                  files: multipart.files,
                  entryFiles: multipart.entryFiles,
                  skippedCount: multipart.skippedCount,
                  contents: multipart.contents,
                },
              }
            : {}),
          catalog: catalog.slice(0, 80).map((version) => ({
            cfId: version.cfId,
            version: version.version,
            name: version.draft.name,
            does: version.draft.does,
          })),
        } as unknown as Json
        const deadline = AbortSignal.timeout(runtimes.settings().testTimeoutMs)
        let response: Json
        try {
          response = multipart
            ? await runtimes.executeAnalysis(
                runtimeId!,
                prompt,
                input,
                deadline,
                { cwd: multipart.root, allowedRoot: multipart.root },
                flowProposalOutputSchema(true),
              )
            : await runtimes.execute(
                runtimeId!,
                prompt,
                input,
                deadline,
                [],
                flowProposalOutputSchema(false),
                { workspaceRoot },
              )
        } catch (error) {
          await discard()
          throw error
        }
        const proposal = response as any
        if (!proposal || typeof proposal !== 'object' || !Array.isArray(proposal.stages))
          throw await failing('RUNTIME_PROPOSAL_INVALID')
        if (multipart) {
          const failures = collectGroundingFailures(proposal, multipart.contents)
          if (failures.length) {
            req.log.warn(
              {
                attachmentFiles: multipart.files.length,
                sourceChars: multipart.contents.reduce((sum, item) => sum + item.content.length, 0),
                failures: failures.map((item) => ({
                  ...item,
                  quote: item.quote.slice(0, 160),
                })),
              },
              'flow proposal rejected: stages not grounded in the uploaded source',
            )
            await discard()
            throw groundingError(failures, proposal)
          }
        }
        const graph = buildProposalGraph(proposal.stages, { catalog, runtimeId })
        return asProposal(
          graph,
          String(proposal.flowName ?? objective),
          String(proposal.summary ?? 'Runtime 已生成可审阅的 Flow 草案。').slice(0, 1000),
        )
      }

      const matched = matchPublishedCapabilities(objective, catalog)
      if (!matched.length)
        return persistFlowProposal(
          { objective, flowDraft: null, unresolvedSuggestions: ['NO_PUBLISHED_CF_MATCH'] },
          multipart,
        )
      const graph = buildProposalGraph(
        matched.map((version) => ({
          kind: 'cf-call',
          name: version.draft.name,
          does: version.draft.does,
          cfId: version.cfId,
        })),
        { catalog },
      )
      return asProposal(graph, objective)
    },
  )
  app.post<{ Body: AgentRequest }>('/api/flow-agent/chat', async (req) => {
    const message = req.body.message?.trim()
    if (!message) throw new Error('AGENT_MESSAGE_REQUIRED')
    const catalog = versions()
    const fallback = flowAgentFallback({ ...req.body, message }, catalog)
    const runtimeId = req.body.runtimeId?.trim() || runtimes.settings().defaultRuntimeId
    const profile = runtimeId ? runtimes.profile(runtimeId) : undefined
    if (!profile || profile.backend === 'builtin') return { ...fallback, fallback: true }
    if (!req.body.flowDraft) throw new Error('FLOW_WORKSPACE_REQUIRED')
    const workspaceRoot = operationalWorkspace(req.body.flowDraft)
    const health = await runtimes.health(runtimeId)
    if (health.status !== 'available') return { ...fallback, fallback: true }
    const availableRuntimes: { id: string; name: string }[] = []
    for (const item of runtimes.profiles()) {
      if (!item.enabled) continue
      const itemHealth = item.id === runtimeId ? health : await runtimes.health(item.id)
      if (itemHealth.status === 'available')
        availableRuntimes.push({ id: item.id, name: item.name })
    }
    const grounded = Boolean(req.body.attachments?.length)
    const response = await runtimes.execute(
      runtimeId,
      flowAgentPrompt(message, grounded),
      flowAgentContext({ ...req.body, message }, availableRuntimes, catalog),
      AbortSignal.timeout(runtimes.settings().testTimeoutMs),
      [],
      flowAgentOutputSchema(grounded),
      { workspaceRoot },
    )
    const normalized = normalizeAgentResponse(response)
    if (normalized.intent === 'answer') return { ...normalized, runtimeId }
    if (grounded) assertAttachmentGrounding(normalized, req.body.attachments ?? [])
    const revised = applyFlowRevision(
      req.body.flowDraft,
      req.body.cfDrafts ?? [],
      normalized.stages,
      { catalog, runtimeId },
    )
    store.db.transaction(() => {
      for (const draft of revised.cfDrafts) store.save('cf_drafts', draft.cfId, draft)
      store.save('flow_drafts', revised.flowDraft.flowId, revised.flowDraft)
    })()
    return { ...normalized, ...revised, runtimeId }
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
    const draft = normalizeNewFlowWorkspace(req.body)
    operationalWorkspace(draft)
    const catalog = versions()
    const plan = await pinRuntimeProfiles(
      compileFlow(draft, new Map(catalog.map((v) => [`${v.cfId}@${v.version}`, v]))),
      catalog,
    )
    store.save('flow_drafts', draft.flowId, draft)
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
    operationalWorkspace(req.body.flowDraft)
    const candidateVersions = (req.body.cfDrafts ?? []).map(compileCF)
    const catalog = new Map(
      [...versions(), ...candidateVersions].map((version) => [
        `${version.cfId}@${version.version}`,
        version,
      ]),
    )
    const selectedDraft = applyCompileRuntime(req.body.flowDraft, req.body.runtimeId)
    store.save('flow_drafts', req.body.flowDraft.flowId, req.body.flowDraft)
    const compiled = compileFlow(selectedDraft, catalog)
    const plan = await pinRuntimeProfiles(compiled, [...versions(), ...candidateVersions])
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
    validateWorkspaceRoot(plan.workspaceRoot)
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
      testPlans.get(run.flow_version_id) ??
      store.get<FlowPlan>('flow_versions', run.flow_version_id)
    if (plan) engine.start(job.runId, plan)
  }, 250)
  app.addHook('onClose', async () => clearInterval(recover))
  return app
}

export const isDirectExecution = (entryPath = process.argv[1]) => {
  if (!entryPath) return false
  try {
    return realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isDirectExecution()) {
  mkdirSync('./data', { recursive: true })
  const app = createApp()
  await app.listen({
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 3000),
  })
}

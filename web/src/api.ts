import type {
  BootstrapData,
  CFDraft,
  CFVersion,
  CompilationPreview,
  FlowDraft,
  FlowAgentResponse,
  FlowPlan,
  FlowProposal,
  RunSummary,
  RunDetail,
  RuntimeWithHealth,
  RuntimeDiscoveryResult,
  WorkspaceSettings,
  WorkspaceFileSearchResult,
  DraftBundle,
  ProjectAgentConfig,
  ProjectAgentMutationResult,
} from './types'
import { messagesFor, type Locale } from './i18n'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData
  const response = await fetch(path, {
    ...init,
    headers:
      init?.body && !isForm
        ? { 'Content-Type': 'application/json', ...init.headers }
        : init?.headers,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error ?? body.message ?? `${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

export const api = {
  async bootstrap(): Promise<BootstrapData> {
    const [
      workspace,
      cfs,
      plans,
      runs,
      resources,
      runtimeDiscovery,
      projectAgents,
      settings,
      flowDrafts,
      cfDrafts,
    ] = await Promise.all([
      request<BootstrapData['workspace']>('/api/workspace'),
      request<BootstrapData['cfs']>('/api/cfs'),
      request<BootstrapData['plans']>('/api/flows'),
      request<BootstrapData['runs']>('/api/runs'),
      request<BootstrapData['resources']>('/api/resources'),
      request<RuntimeDiscoveryResult>('/api/runtimes/discover', {
        method: 'POST',
        body: '{}',
      }),
      request<ProjectAgentConfig[]>('/api/project-agents'),
      request<BootstrapData['settings']>('/api/settings'),
      request<BootstrapData['flowDrafts']>('/api/flow-drafts'),
      request<BootstrapData['cfDrafts']>('/api/cf-drafts'),
    ])
    const flowCompilations = await request<BootstrapData['flowCompilations']>(
      '/api/flow-compilations',
    ).catch(() => [])
    return {
      workspace,
      cfs,
      plans,
      runs,
      flowCompilations,
      resources,
      runtimes: runtimeDiscovery.runtimes,
      projectAgents,
      runtimeDiscoveryWarnings: runtimeDiscovery.warnings,
      settings,
      flowDrafts,
      cfDrafts,
    }
  },
  propose(objective: string, runtimeId: string, attachments: File[] = [], invocationId?: string) {
    if (!attachments.length)
      return request<FlowProposal>('/api/flow-proposals', {
        method: 'POST',
        body: JSON.stringify({ objective, runtimeId, invocationId }),
      })
    const body = new FormData()
    body.set('objective', objective)
    body.set('runtimeId', runtimeId)
    if (invocationId) body.set('invocationId', invocationId)
    attachments.forEach((file) =>
      body.append(
        'attachments',
        file,
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      ),
    )
    return request<FlowProposal>('/api/flow-proposals', { method: 'POST', body })
  },
  flowAgentChat(input: {
    message: string
    runtimeId?: string
    flowDraft: FlowDraft | null
    cfDrafts?: CFDraft[]
    conversation?: { role: 'user' | 'assistant'; body: string }[]
    selection?: { nodeId?: string | null; edgeId?: string | null }
    check?: { error?: string | null }
    runDetail?: RunDetail | null
    attachments?: File[]
    invocationId?: string
    messageId?: string
  }) {
    const { attachments = [], ...snapshot } = input
    const attachmentContents = Promise.all(
      attachments.slice(0, 20).map(async (file) => ({
        path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
        content: (await file.text()).slice(0, 80_000),
      })),
    )
    return attachmentContents.then((contents) =>
      request<FlowAgentResponse>('/api/flow-agent/chat', {
        method: 'POST',
        body: JSON.stringify({ ...snapshot, attachments: contents }),
      }),
    )
  },
  saveDraft(flowDraft: FlowDraft, cfDrafts: CFDraft[]) {
    return request<DraftBundle>(`/api/flow-drafts/${encodeURIComponent(flowDraft.flowId)}`, {
      method: 'PUT',
      body: JSON.stringify({ flowDraft, cfDrafts }),
    })
  },
  createDemoFlow() {
    return request<DraftBundle>('/api/flow-drafts/demo', { method: 'POST', body: '{}' })
  },
  searchWorkspaceFiles(query: string, selected: string[]) {
    return request<WorkspaceFileSearchResult>('/api/workspace/files/search', {
      method: 'POST',
      body: JSON.stringify({ query, selected }),
    })
  },
  deleteDraft(flowId: string) {
    return request<{ deleted: true }>(`/api/flow-drafts/${encodeURIComponent(flowId)}`, {
      method: 'DELETE',
    })
  },
  deletePublishedFlow(flowId: string, flowVersion: string) {
    return request<{ deleted: true }>(
      `/api/flows/${encodeURIComponent(flowId)}/${encodeURIComponent(flowVersion)}`,
      { method: 'DELETE' },
    )
  },
  compile(flowDraft: FlowDraft, cfDrafts: CFDraft[], runtimeId?: string) {
    return request<CompilationPreview>('/api/flow-compilations', {
      method: 'POST',
      body: JSON.stringify({ flowDraft, cfDrafts, runtimeId }),
    })
  },
  test(
    flowDraft: FlowDraft,
    cfDrafts: CFDraft[],
    resourceProfileId?: string,
    runtimeId?: string,
    input: unknown = {},
  ) {
    return request<{ runId: string; test: true; plan: FlowPlan; programs: CFVersion[] }>(
      '/api/flow-tests',
      {
        method: 'POST',
        body: JSON.stringify({ flowDraft, cfDrafts, input, resourceProfileId, runtimeId }),
      },
    )
  },
  getRun(id: string) {
    return request<RunDetail>(`/api/runs/${encodeURIComponent(id)}`)
  },
  getAgentInvocation(id: string) {
    return request<import('./types').AgentInvocationDetail>(
      `/api/agent-invocations/${encodeURIComponent(id)}`,
    )
  },
  run(flowId: string, flowVersion: string, resourceProfileId?: string, input: unknown = {}) {
    return request<{ runId: string }>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ flowId, flowVersion, input, resourceProfileId }),
    })
  },
  cancelRun(runId: string) {
    return request<{ cancelled: true }>(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
      body: '{}',
    })
  },
  async publish(flowDraft: FlowDraft, cfDrafts: CFDraft[]): Promise<FlowPlan> {
    const versions = await Promise.all(
      cfDrafts.map((draft) =>
        request<CFVersion>('/api/cfs', { method: 'POST', body: JSON.stringify(draft) }),
      ),
    )
    const versionById = new Map(versions.map((version) => [version.cfId, version.version]))
    const resolvedDraft: FlowDraft = {
      ...flowDraft,
      nodes: flowDraft.nodes.map((node) =>
        node.kind === 'cf-call' && versionById.has(node.cfRef.cfId)
          ? { ...node, cfRef: { ...node.cfRef, version: versionById.get(node.cfRef.cfId)! } }
          : node,
      ),
    }
    return request<FlowPlan>('/api/flows', {
      method: 'POST',
      body: JSON.stringify(resolvedDraft),
    })
  },
  saveSettings(settings: Partial<WorkspaceSettings>) {
    return request<WorkspaceSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    })
  },
  testRuntime(id: string) {
    return request<RuntimeWithHealth['health']>(`/api/runtimes/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      body: '{}',
    })
  },
  discoverRuntimes() {
    return request<RuntimeDiscoveryResult>('/api/runtimes/discover', {
      method: 'POST',
      body: '{}',
    })
  },
  createProjectAgent(config: ProjectAgentConfig) {
    return request<ProjectAgentMutationResult>('/api/project-agents', {
      method: 'POST',
      body: JSON.stringify(config),
    })
  },
  updateProjectAgent(config: ProjectAgentConfig) {
    return request<ProjectAgentMutationResult>(
      `/api/project-agents/${encodeURIComponent(config.id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(config),
      },
    )
  },
  deleteProjectAgent(id: string) {
    return request<ProjectAgentMutationResult>(`/api/project-agents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },
}

export function readableError(error: unknown, locale: Locale = 'zh-CN') {
  const raw = error instanceof Error ? error.message : String(error)
  const known = messagesFor(locale).errors
  const key = (Object.keys(known) as (keyof typeof known)[]).find((candidate) =>
    raw.includes(candidate),
  )
  return key ? known[key] : raw
}

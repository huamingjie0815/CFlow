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
  WorkspaceSettings,
} from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error ?? body.message ?? `${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

export const api = {
  async bootstrap(): Promise<BootstrapData> {
    const [cfs, plans, runs, resources, runtimes, settings, flowDrafts, cfDrafts] =
      await Promise.all([
        request<BootstrapData['cfs']>('/api/cfs'),
        request<BootstrapData['plans']>('/api/flows'),
        request<BootstrapData['runs']>('/api/runs'),
        request<BootstrapData['resources']>('/api/resources'),
        request<BootstrapData['runtimes']>('/api/runtimes'),
        request<BootstrapData['settings']>('/api/settings'),
        request<BootstrapData['flowDrafts']>('/api/flow-drafts'),
        request<BootstrapData['cfDrafts']>('/api/cf-drafts'),
      ])
    const flowCompilations = await request<BootstrapData['flowCompilations']>('/api/flow-compilations').catch(
      () => [],
    )
    return { cfs, plans, runs, flowCompilations, resources, runtimes, settings, flowDrafts, cfDrafts }
  },
  propose(objective: string, runtimeId: string) {
    return request<FlowProposal>('/api/flow-proposals', {
      method: 'POST',
      body: JSON.stringify({ objective, runtimeId }),
    })
  },
  flowAgentChat(input: {
    message: string
    runtimeId?: string
    flowDraft: FlowDraft | null
    cfDrafts?: CFDraft[]
    runDetail?: RunDetail | null
  }) {
    return request<FlowAgentResponse>('/api/flow-agent/chat', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  saveDraft(draft: FlowDraft) {
    return request<FlowDraft>(`/api/flow-drafts/${encodeURIComponent(draft.flowId)}`, {
      method: 'PUT',
      body: JSON.stringify(draft),
    })
  },
  deleteDraft(flowId: string) {
    return request<{ deleted: true }>(`/api/flow-drafts/${encodeURIComponent(flowId)}`, {
      method: 'DELETE',
    })
  },
  compile(flowDraft: FlowDraft, cfDrafts: CFDraft[], runtimeId?: string) {
    return request<CompilationPreview>('/api/flow-compilations', {
      method: 'POST',
      body: JSON.stringify({ flowDraft, cfDrafts, runtimeId }),
    })
  },
  test(flowDraft: FlowDraft, cfDrafts: CFDraft[], resourceProfileId?: string, runtimeId?: string) {
    return request<{ runId: string; test: true; plan: FlowPlan; programs: CFVersion[] }>(
      '/api/flow-tests',
      {
      method: 'POST',
      body: JSON.stringify({ flowDraft, cfDrafts, input: {}, resourceProfileId, runtimeId }),
      },
    )
  },
  getRun(id: string) {
    return request<RunDetail>(`/api/runs/${encodeURIComponent(id)}`)
  },
  run(flowId: string, flowVersion: string, resourceProfileId?: string) {
    return request<{ runId: string }>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ flowId, flowVersion, input: {}, resourceProfileId }),
    })
  },
  decideApproval(runId: string, node: number, decision: 'approved' | 'rejected') {
    return request<{ runId: string; node: number; decision: string }>(
      `/api/runs/${encodeURIComponent(runId)}/approvals/${node}`,
      { method: 'POST', body: JSON.stringify({ decision }) },
    )
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
}

export function readableError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error)
  const known: Record<string, string> = {
    OBJECTIVE_REQUIRED: '请先写下你想完成的事。',
    FLOW_CYCLE: '步骤连成了圈，流程走不完。请改一下连线。',
    FLOW_NO_ENTRY: '还没有从「开始」连出的第一步。',
    FLOW_NO_OUTPUT: '请加一个「输出」步骤，用来收下最终结果。',
    RUNTIME_UNAVAILABLE: '当前选中的助手还不能用，请换一个可用的。',
    RESOURCE_BINDING_REQUIRED: '这条流程还缺要用的资料，请先在设置里补全。',
    AGENT_MESSAGE_REQUIRED: '请先写下想咨询的问题。',
    RUNTIME_AGENT_RESPONSE_INVALID: '助手返回的分析格式不完整，请重试。',
  }
  const key = Object.keys(known).find((candidate) => raw.includes(candidate))
  return key ? known[key] : raw
}

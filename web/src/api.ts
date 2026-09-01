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
} from './types'

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
      runtimeDiscoveryWarnings: runtimeDiscovery.warnings,
      settings,
      flowDrafts,
      cfDrafts,
    }
  },
  propose(objective: string, runtimeId: string, attachments: File[] = []) {
    if (!attachments.length)
      return request<FlowProposal>('/api/flow-proposals', {
        method: 'POST',
        body: JSON.stringify({ objective, runtimeId }),
      })
    const body = new FormData()
    body.set('objective', objective)
    body.set('runtimeId', runtimeId)
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
  discoverRuntimes() {
    return request<RuntimeDiscoveryResult>('/api/runtimes/discover', {
      method: 'POST',
      body: '{}',
    })
  },
}

export function readableError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error)
  const known: Record<string, string> = {
    OBJECTIVE_REQUIRED: '请先写下你想完成的事。',
    NON_TERMINATING_PATH: '步骤连成了圈，流程走不完。请改一下连线。',
    FLOW_NO_ENTRY: '还没有从「开始」连出的第一步。',
    FLOW_NO_OUTPUT: '请加一个「输出」步骤，用来收下最终结果。',
    RUNTIME_UNAVAILABLE: '当前选中的助手还不能用，请换一个可用的。',
    DEFAULT_RUNTIME_NOT_SELECTABLE: '请选择一个真实的本机助手作为默认助手。',
    RESOURCE_BINDING_REQUIRED: '这条流程还缺要用的资料，请先在设置里补全。',
    AGENT_MESSAGE_REQUIRED: '请先写下想咨询的问题。',
    RUNTIME_ANALYSIS_REQUIRED: '分析 skill 附件需要一个可用的 ACP Agent runtime。',
    SKILL_ATTACHMENT_NO_TEXT_FILES: '附件中没有可分析的文本文件，请选择 SKILL.md 或 skill 文件夹。',
    RUNTIME_AGENT_RESPONSE_INVALID: '助手返回的分析格式不完整，请重试。',
    RUNTIME_PROPOSAL_UNGROUNDED:
      '生成结果无法与附件原文对应，已拦截这份草案。请重试，或在目标中说明要执行文件内描述的流程。',
    FLOW_VERSION_NOT_FOUND: '这条已发布版本已经不存在，请刷新工作台。',
    FLOW_WORKSPACE_REQUIRED: '当前流程缺少工作区信息，请刷新工作台。',
    FLOW_WORKSPACE_MISMATCH: '这条流程不属于当前启动目录，请从对应目录启动 CFlow。',
    FLOW_DRAFT_STALE: '这份草稿已经有更新版本，请重新选择后再编辑。',
    UNKNOWN_CF: '有步骤还没有填写内容，或者它引用的说明已经不在了。请打开这个步骤补齐。',
    FLOW_DUPLICATE_NODE: '有两个步骤用了同一个编号，请删掉多余的那个。',
    FLOW_DUPLICATE_EDGE: '有两条重复的连线，请删掉一条。',
    UNREACHABLE_NODE: '有步骤没有连进流程，从「开始」走不到它。请补上连线或删掉它。',
    OUTPUT_MUST_BE_TERMINAL: '「输出」必须是最后一步，它后面不能再接别的步骤。',
    NON_TERMINAL_NODE: '有步骤后面没有接任何东西，请把它连到下一步或「输出」。',
    BRANCH_CASES_INCOMPLETE: '分支的每个情况都要有一条对应的连线，请补齐。',
    BRANCH_CONDITION_REQUIRED: '分支还有情况没有写判断条件，请补上。',
    FLOW_EMPTY: '这条流程还没有任何步骤。',
    CF_DOES_REQUIRED: '有步骤没有说明要做什么，请补上。',
    CF_PROGRAM_VERSION_UNSUPPORTED: '这个步骤是旧版本生成的，请重新发布一次。',
    PROGRAM_HASH_MISMATCH: '步骤内容和已发布的版本不一致，请重新检查并发布。',
    PLAN_HASH_MISMATCH: '流程内容和已发布的版本不一致，请重新发布。',
    RESOURCE_BINDING_MISSING: '这条流程缺少要用的资料，请先在设置里补全。',
    FLOW_STALLED: '流程走不下去了，请检查分支和连线。',
    NO_TERMINAL_OUTPUT: '流程没有走到「输出」就结束了，请检查连线。',
    STEP_LIMIT_EXCEEDED: '步骤执行次数超出上限，可能存在来回绕圈的连线。',
  }
  const key = Object.keys(known).find((candidate) => raw.includes(candidate))
  return key ? known[key] : raw
}

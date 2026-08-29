import type { FlowDraft, LedgerEvent, RunDetail } from './types'

export type NodeRunState =
  | 'draft'
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'inactive'
  | 'waiting-approval'
  | 'published'

const statusLabels: Record<NodeRunState, string> = {
  draft: '草稿',
  pending: '待执行',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  blocked: '被阻塞',
  inactive: '未启用',
  'waiting-approval': '待审批',
  published: '已发布',
}

export function nodeRunStateLabel(state: NodeRunState) {
  return statusLabels[state]
}

export function nodeRunStateTone(state: NodeRunState) {
  switch (state) {
    case 'running':
    case 'pending':
    case 'waiting-approval':
      return 'running'
    case 'completed':
    case 'published':
      return 'completed'
    case 'failed':
    case 'blocked':
    case 'inactive':
      return 'failed'
    default:
      return 'disabled'
  }
}

export function deriveNodeRunStates(draft: FlowDraft | null, run: RunDetail | null) {
  const states = new Map<string, NodeRunState>()
  if (!draft || !run) return states
  const idByIndex = new Map(draft.nodes.map((node, index) => [index, node.id]))
  for (const event of run.events) {
    if (event.node == null) continue
    const nodeId = idByIndex.get(event.node)
    if (!nodeId) continue
    if (event.type === 'node.started') states.set(nodeId, 'running')
    if (event.type === 'node.completed') states.set(nodeId, 'completed')
    if (event.type === 'node.failed') states.set(nodeId, 'failed')
    if (event.type === 'node.blocked') states.set(nodeId, 'blocked')
    if (event.type === 'node.inactive') states.set(nodeId, 'inactive')
    if (event.type === 'approval.requested') states.set(nodeId, 'waiting-approval')
    if (event.type === 'approval.approved' || event.type === 'approval.rejected')
      states.set(nodeId, 'completed')
  }
  if (['running', 'waiting-approval'].includes(run.run.status)) {
    for (const node of draft.nodes) {
      if (!states.has(node.id)) states.set(node.id, 'pending')
    }
  }
  return states
}

export function summarizeRunEvent(event: LedgerEvent, draft: FlowDraft | null) {
  const nodeIndex = event.node == null ? null : event.node
  const node = nodeIndex == null ? null : draft?.nodes[nodeIndex] ?? null
  const nodeLabel = node && nodeIndex != null ? `${nodeIndex + 1}. ${node.kind}` : null
  if (event.type === 'run.started') return { title: '运行开始', detail: '引擎已经开始执行这条流程。' }
  if (event.type === 'run.completed')
    return {
      title: '运行完成',
      detail: event.data ? `结果已返回：${JSON.stringify(event.data)}` : '结果已返回。',
    }
  if (event.type === 'run.failed')
    return {
      title: '运行失败',
      detail: event.data ? `失败原因：${JSON.stringify(event.data)}` : '运行没有完成。',
    }
  if (event.type === 'run.cancelled')
    return { title: '运行已取消', detail: '这次运行被手动停止。' }
  if (event.type === 'run.needs-reconciliation')
    return { title: '需要补处理', detail: '有一个外部操作需要确认。' }
  if (event.type === 'approval.requested')
    return {
      title: nodeLabel ? `${nodeLabel} 需要审批` : '审批请求',
      detail: event.data ? JSON.stringify(event.data) : '等待人工确认。',
    }
  if (event.type === 'approval.approved' || event.type === 'approval.rejected')
    return {
      title: nodeLabel ? `${nodeLabel} 已处理审批` : '审批已处理',
      detail: event.type === 'approval.approved' ? '已批准继续运行。' : '已拒绝继续。',
    }
  if (event.type === 'node.started')
    return {
      title: nodeLabel ? `${nodeLabel} 开始` : '节点开始',
      detail: event.data ? JSON.stringify(event.data) : '节点进入运行中。',
    }
  if (event.type === 'node.completed') {
    const value = (event.data as { value?: unknown } | undefined)?.value
    return {
      title: nodeLabel ? `${nodeLabel} 完成` : '节点完成',
      detail: value === undefined ? '节点已完成。' : `输出：${JSON.stringify(value)}`,
    }
  }
  if (event.type === 'node.failed') {
    const error = (event.data as { error?: unknown } | undefined)?.error
    return {
      title: nodeLabel ? `${nodeLabel} 失败` : '节点失败',
      detail: error === undefined ? '节点执行失败。' : `错误：${String(error)}`,
    }
  }
  if (event.type === 'node.inactive')
    return {
      title: nodeLabel ? `${nodeLabel} 未启用` : '节点未启用',
      detail: '这条路径没有被选中。',
    }
  if (event.type === 'node.blocked')
    return {
      title: nodeLabel ? `${nodeLabel} 被阻塞` : '节点被阻塞',
      detail: '前置步骤还没有满足。',
    }
  if (event.type === 'node.retry') {
    const attempt = (event.data as { attempt?: unknown } | undefined)?.attempt
    return {
      title: nodeLabel ? `${nodeLabel} 重试` : '节点重试',
      detail: attempt === undefined ? '节点正在重试。' : `第 ${attempt} 次重试。`,
    }
  }
  return {
    title: event.type,
    detail: event.data ? JSON.stringify(event.data) : '没有额外信息。',
  }
}

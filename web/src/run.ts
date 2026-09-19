import { messagesFor, type Locale } from './i18n'
import type { FlowDraft, RunDetail } from './types'

export type NodeRunState =
  'draft' | 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'inactive' | 'published'

export function nodeRunStateLabel(state: NodeRunState, locale: Locale = 'zh-CN') {
  return messagesFor(locale).runState[state]
}

export function nodeRunStateTone(state: NodeRunState) {
  switch (state) {
    case 'running':
    case 'pending':
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

/**
 * A ledger event's `node` is an index into `draft.nodes` (guaranteed by
 * compileFlow, which builds plan.nodes as draft.nodes.map((n, i) => ...)).
 * Shared so the canvas states and the run log resolve identity the same way.
 */
export function nodeIdByIndex(draft: FlowDraft) {
  return new Map(draft.nodes.map((node, index) => [index, node.id]))
}

/**
 * Folds one ledger event type into a node's state. Shared by the canvas node
 * colouring and the run log so both agree on what a step's status is.
 * Returns `current` unchanged for event types that carry no state meaning.
 */
export function foldNodeEventState(
  current: NodeRunState | undefined,
  type: string,
): NodeRunState | undefined {
  switch (type) {
    case 'node.started':
      return 'running'
    case 'node.completed':
      return 'completed'
    case 'node.failed':
      return 'failed'
    case 'node.blocked':
      return 'blocked'
    case 'node.inactive':
      return 'inactive'
    default:
      return current
  }
}

export function deriveNodeRunStates(draft: FlowDraft | null, run: RunDetail | null) {
  const states = new Map<string, NodeRunState>()
  if (!draft || !run) return states
  const idByIndex = nodeIdByIndex(draft)
  for (const event of run.events) {
    if (event.node == null) continue
    const nodeId = idByIndex.get(event.node)
    if (!nodeId) continue
    const next = foldNodeEventState(states.get(nodeId), event.type)
    if (next) states.set(nodeId, next)
  }
  if (run.run.status === 'running') {
    for (const node of draft.nodes) {
      if (!states.has(node.id)) states.set(node.id, 'pending')
    }
  }
  return states
}

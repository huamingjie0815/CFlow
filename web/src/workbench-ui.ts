import type { FlowDraft, FlowEdge } from './types'

type CanvasConnection = { source: string | null; target: string | null }

export function isValidCanvasConnection(
  draft: FlowDraft,
  connection: CanvasConnection,
  replacingId?: string,
) {
  const { source, target } = connection
  const original = replacingId ? draft.edges.find((edge) => edge.id === replacingId) : undefined
  return Boolean(
    source &&
    target &&
    source !== target &&
    (source === '$entry' || draft.nodes.some((node) => node.id === source)) &&
    draft.nodes.some((node) => node.id === target) &&
    (!replacingId || (original && (original.from !== '$entry' || source === '$entry'))) &&
    !draft.edges.some(
      (edge) => edge.id !== replacingId && edge.from === source && edge.to === target,
    ),
  )
}

export function reconnectCanvasEdge(draft: FlowDraft, id: string, connection: CanvasConnection) {
  if (!isValidCanvasConnection(draft, connection, id)) return draft
  const original = draft.edges.find((edge) => edge.id === id)!
  if (original.from === connection.source && original.to === connection.target) return draft
  return {
    ...draft,
    revision: draft.revision + 1,
    edges: draft.edges.map((edge) =>
      edge.id === id ? { ...edge, from: connection.source!, to: connection.target! } : edge,
    ),
  }
}

export type RunMode = 'test' | 'live' | null
export type TestState = 'idle' | 'running' | 'passed' | 'failed' | 'cancelled' | 'published'
export type DrawerTab = 'log' | 'check'

export const DETAIL_PANEL_DEFAULT_WIDTH = 300
export const AGENT_PANEL_DEFAULT_WIDTH = 340
export const PANEL_MIN_WIDTH = 240
export const PANEL_MAX_WIDTH = 520
export const PANEL_CENTER_MIN_WIDTH = 560

export type PanelWidths = { left: number; right: number }

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function clampPanelWidth(
  requestedWidth: number,
  containerWidth: number,
  oppositeWidth: number,
) {
  const availableMaximum = Math.max(
    PANEL_MIN_WIDTH,
    containerWidth - PANEL_CENTER_MIN_WIDTH - oppositeWidth,
  )
  return clamp(requestedWidth, PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, availableMaximum))
}

/** Keeps restored widths valid when the desktop window becomes narrower. */
export function constrainPanelWidths(widths: PanelWidths, containerWidth: number): PanelWidths {
  let left = clamp(widths.left, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH)
  let right = clamp(widths.right, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH)
  const availableTotal = Math.max(PANEL_MIN_WIDTH * 2, containerWidth - PANEL_CENTER_MIN_WIDTH)
  const overflow = left + right - availableTotal
  if (overflow <= 0) return { left, right }

  const leftRoom = left - PANEL_MIN_WIDTH
  const rightRoom = right - PANEL_MIN_WIDTH
  const totalRoom = leftRoom + rightRoom
  const leftReduction = totalRoom > 0 ? Math.min(leftRoom, overflow * (leftRoom / totalRoom)) : 0
  left -= leftReduction
  right -= Math.min(rightRoom, overflow - leftReduction)
  return { left: Math.round(left), right: Math.round(right) }
}

export function applyCurrentRuntime<T extends { runtimeId?: string }>(
  snapshot: T,
  runtimeId?: string,
): T {
  return { ...snapshot, runtimeId }
}

/** Which single action gets the one filled button on screen. */
export type SignalAction = 'goal' | 'check' | 'test' | 'publish' | 'run' | null

type TestSnapshot = { flowId: string; mode: 'preview' | 'test' }

type CanvasNodeLike = {
  id: string
  position: { x: number; y: number }
}

/**
 * DESIGN.md allows exactly one filled button per screen. With 检查/测试/运行/发布
 * sharing one toolbar row that is impossible to hold by eye, so it is computed:
 * a single return value makes two fills unrepresentable.
 */
export function nextSignalAction(input: {
  hasDraft: boolean
  workspaceAvailable: boolean
  isRunning: boolean
  hasPreview: boolean
  testState: TestState
  hasPublishedPlan: boolean
}): SignalAction {
  // No flow yet: the goal composer's send button is the screen's one action.
  if (!input.hasDraft) return 'goal'
  // While running, the only live control is 停止 — which is outline-red, not filled.
  if (input.isRunning) return null
  // Every gated action is disabled, so nothing should invite a click.
  if (!input.workspaceAvailable) return null
  if (!input.hasPreview) return 'check'
  if (input.testState !== 'passed' && input.testState !== 'published') return 'test'
  if (input.testState === 'passed') return 'publish'
  if (input.testState === 'published' && input.hasPublishedPlan) return 'run'
  return null
}

export function snapshotFileList<T>(files: ArrayLike<T> | null): T[] {
  return files ? Array.from(files) : []
}

export function flowTestCounts(snapshots: readonly TestSnapshot[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const snapshot of snapshots) {
    if (snapshot.mode !== 'test') continue
    counts[snapshot.flowId] = (counts[snapshot.flowId] ?? 0) + 1
  }
  return counts
}

/** Arrange a DAG in vertical layers, spreading sibling branches horizontally. */
export function arrangeCanvasPositions(
  nodeIds: readonly string[],
  edges: readonly Pick<FlowEdge, 'from' | 'to'>[] = [],
): Record<string, { x: number; y: number }> {
  const nodeX = 220
  const entryX = 262
  const entryY = 32
  const firstNodeY = 132
  const nodeGap = 190
  const columnGap = 260
  const nodeSet = new Set(nodeIds)
  const incoming = new Map<string, number>(nodeIds.map((id) => [id, 0]))
  const outgoing = new Map<string, string[]>(nodeIds.map((id) => [id, []]))
  for (const edge of edges) {
    if (!nodeSet.has(edge.to)) continue
    if (edge.from !== '$entry' && !nodeSet.has(edge.from)) continue
    if (edge.from !== '$entry') {
      incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
      outgoing.get(edge.from)!.push(edge.to)
    }
  }

  const ranks = new Map<string, number>()
  const queue = nodeIds.filter((id) => incoming.get(id) === 0)
  for (const id of queue) ranks.set(id, 1)
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]
    const nextRank = (ranks.get(current) ?? 1) + 1
    for (const next of outgoing.get(current) ?? []) {
      ranks.set(next, Math.max(ranks.get(next) ?? 1, nextRank))
      const remaining = (incoming.get(next) ?? 1) - 1
      incoming.set(next, remaining)
      if (remaining === 0) queue.push(next)
    }
  }
  // Keep malformed or temporarily disconnected drafts visible instead of stacking them.
  let fallbackRank = Math.max(0, ...ranks.values()) + 1
  for (const id of nodeIds) {
    if (!ranks.has(id)) ranks.set(id, fallbackRank++)
  }

  const layers = new Map<number, string[]>()
  for (const id of nodeIds) {
    const rank = ranks.get(id)!
    const layer = layers.get(rank) ?? []
    layer.push(id)
    layers.set(rank, layer)
  }
  return {
    $entry: { x: entryX, y: entryY },
    ...Object.fromEntries(
      [...layers.entries()].flatMap(([rank, ids]) =>
        ids.map((id, index) => [
          id,
          {
            x: nodeX + (index - (ids.length - 1) / 2) * columnGap,
            y: firstNodeY + (rank - 1) * nodeGap,
          },
        ]),
      ),
    ),
  }
}

/** Keep React Flow's measured geometry and live position while refreshing node content. */
export function reconcileCanvasNodes<T extends CanvasNodeLike>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const currentById = new Map(current.map((node) => [node.id, node]))
  return incoming.map((node) => {
    const existing = currentById.get(node.id)
    return existing ? { ...existing, ...node, position: existing.position } : node
  })
}

export function attachmentName(file: File) {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
}

export function attachmentSize(file: File) {
  return `${Math.max(1, Math.round(file.size / 1024))} KB`
}

/** Merges newly picked files into the staged set, keyed by path so re-picking
 *  the same file replaces rather than duplicates it. */
export function mergeAttachments(current: readonly File[], incoming: readonly File[]): File[] {
  const byName = new Map(current.map((file) => [attachmentName(file), file]))
  for (const file of incoming) byName.set(attachmentName(file), file)
  return [...byName.values()]
}

export function runtimeStatus(runtime: { enabled: boolean; health?: { status?: string } }) {
  if (!runtime.enabled) return 'disabled'
  return runtime.health?.status ?? 'checking'
}

export function runStopControl(runMode: RunMode, runId: string | null) {
  if (!runMode) return null
  if (!runId) {
    return {
      label: runMode === 'test' ? '正在启动测试' : '正在启动运行',
      disabled: true,
    }
  }
  return {
    label: runMode === 'test' ? '停止测试' : '停止运行',
    disabled: false,
  }
}

export function draftSaveStatus(input: { isPending: boolean; isError: boolean; dirty: boolean }) {
  if (!input.dirty) return null
  if (input.isPending) return '保存中'
  if (input.isError) return '保存失败'
  return '待保存'
}

export function persistedDraftRevision(flowId: string, drafts: readonly FlowDraft[]) {
  return drafts.find((draft) => draft.flowId === flowId)?.revision ?? 0
}

export function reconcileRestoredDraft(
  localDraft: FlowDraft | null,
  localDirty: boolean,
  persistedDrafts: readonly FlowDraft[],
) {
  if (!localDraft) return { draft: null, dirty: false, source: 'none' as const }
  const persisted = persistedDrafts.find((draft) => draft.flowId === localDraft.flowId)
  if (persisted && persisted.revision > localDraft.revision)
    return { draft: persisted, dirty: false, source: 'server' as const }
  return { draft: localDraft, dirty: localDirty, source: 'local' as const }
}

export function canApplyAgentRevision(
  requested: { flowId: string; revision: number },
  current: { flowId: string; revision: number } | null,
) {
  return current?.flowId === requested.flowId && current.revision === requested.revision
}

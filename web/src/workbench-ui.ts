export type RunMode = 'test' | 'live' | null
export type TestState = 'idle' | 'running' | 'passed' | 'failed' | 'cancelled' | 'published'
export type DrawerTab = 'log' | 'check'

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

/** Arrange the entry point and flow nodes on one centered vertical axis. */
export function arrangeCanvasPositions(nodeIds: readonly string[]): Record<string, { x: number; y: number }> {
  const nodeX = 220
  const entryX = 262
  const entryY = 32
  const firstNodeY = 132
  const nodeGap = 190
  return {
    $entry: { x: entryX, y: entryY },
    ...Object.fromEntries(
      nodeIds.map((id, index) => [id, { x: nodeX, y: firstNodeY + index * nodeGap }]),
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

export function canApplyAgentRevision(
  requested: { flowId: string; revision: number },
  current: { flowId: string; revision: number } | null,
) {
  return current?.flowId === requested.flowId && current.revision === requested.revision
}

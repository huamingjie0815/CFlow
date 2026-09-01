import type { FlowDraft, FlowPlan } from './types'

/**
 * The top-bar flow switcher shows one flat list instead of the old
 * 草稿 / 已发布 groups. One row per selectable artifact — every draft plus
 * every published version — because deleting a published version targets an
 * exact `flowVersion`, so versions cannot be collapsed away.
 */

export type FlowListRow = {
  /** Unique per row: `flowId` for a draft, `flowId@flowVersion` for a version. */
  key: string
  flowId: string
  kind: 'draft' | 'published'
  name: string
  /** '草稿' or 'v2 已发布' */
  statusLabel: string
  statusTone: 'draft' | 'published'
  /** '测试 3 次 · 7 个步骤' or '7 个步骤' */
  detail: string
  flowVersion?: string
  searchText: string
}

const stepCount = (count: number) => `${count} 个步骤`

export function buildFlowList(
  drafts: FlowDraft[],
  plans: FlowPlan[],
  currentFlowId: string | null = null,
  testCounts: Record<string, number> = {},
): FlowListRow[] {
  const rows: FlowListRow[] = [
    ...drafts.map((draft) => ({
      key: draft.flowId,
      flowId: draft.flowId,
      kind: 'draft' as const,
      name: draft.name?.trim() || draft.objective?.trim() || '未命名流程',
      statusLabel: '草稿',
      statusTone: 'draft' as const,
      detail: `测试 ${testCounts[draft.flowId] ?? 0} 次 · ${stepCount(draft.nodes.length)}`,
      searchText: `${draft.name} ${draft.objective} ${draft.flowId}`.toLowerCase(),
    })),
    ...plans.map((plan) => ({
      key: `${plan.flowId}@${plan.flowVersion}`,
      flowId: plan.flowId,
      kind: 'published' as const,
      name: plan.objective?.trim() || plan.flowId,
      statusLabel: `v${plan.flowVersion} 已发布`,
      statusTone: 'published' as const,
      detail: stepCount(plan.nodes.length),
      flowVersion: plan.flowVersion,
      searchText: `${plan.objective} ${plan.flowId}`.toLowerCase(),
    })),
  ]
  // The flow being worked on floats to the top; everything else is by name so
  // rows belonging to one flow sit together.
  return rows.sort((a, b) => {
    const aCurrent = currentFlowId != null && a.flowId === currentFlowId
    const bCurrent = currentFlowId != null && b.flowId === currentFlowId
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1
    const byName = a.name.localeCompare(b.name, 'zh')
    if (byName !== 0) return byName
    if (a.kind !== b.kind) return a.kind === 'draft' ? -1 : 1
    return a.key.localeCompare(b.key)
  })
}

export function filterFlowList(rows: FlowListRow[], query: string): FlowListRow[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter((row) => row.searchText.includes(needle))
}

/** What the closed trigger shows. */
export function currentFlowLabel(
  rows: FlowListRow[],
  flowId: string | null,
): { name: string; statusLabel: string; statusTone: 'draft' | 'published' | 'none' } {
  if (!flowId) return { name: '还没有流程', statusLabel: '', statusTone: 'none' }
  const match = rows.find((row) => row.flowId === flowId)
  if (!match) return { name: '未命名流程', statusLabel: '草稿', statusTone: 'draft' }
  return { name: match.name, statusLabel: match.statusLabel, statusTone: match.statusTone }
}

import { describeNode, nodeConfigNote } from './flow-labels'
import { foldNodeEventState, nodeIdByIndex, type NodeRunState } from './run'
import { nodeKindLabel } from './copy'
import type { CFDraft, CFVersion, FlowDraft, LedgerEvent, RunDetail } from './types'
import type { FileExtractionResult } from '../../src/types'

/**
 * Run log: turns the flat, seq-ordered ledger into something a colleague who
 * does not write code can read — grouped by the step it belongs to, in the
 * order the steps actually ran.
 *
 * Two rules matter:
 *  - Steps can run in parallel and the engine settles inactive/blocked
 *    transitions before dispatching, so declaration order is NOT execution
 *    order. Groups are ordered by each group's first event `seq`.
 *  - No raw event type string may ever reach a title. Every type has copy.
 */

export type EventTone = 'running' | 'completed' | 'failed' | 'disabled'

export type RunLogEntry = {
  seq: number
  type: string
  at: string
  tone: EventTone
  title: string
  detail: string
  /** Raw payload, shown only inside a 技术细节 disclosure. */
  technical?: string
  extraction?: FileExtractionResult
}

export type RunLogGroup = {
  key: string
  kind: 'run' | 'node'
  nodeId?: string
  nodeIndex?: number
  /** 1-based dispatch order among node groups. */
  order?: number
  title: string
  kindLabel?: string
  configNote?: string
  state?: NodeRunState
  firstSeq: number
  lastAt: string
  /** The run happened against a different revision; the step no longer exists. */
  stale?: boolean
  entries: RunLogEntry[]
}

export type RunLog = { run: RunLogGroup; nodes: RunLogGroup[] }

export function compactJson(value: unknown, limit = 200) {
  const json = JSON.stringify(value)
  if (!json) return ''
  return json.length > limit ? `${json.slice(0, limit - 1)}…` : json
}

export function formatJson(value: unknown) {
  const json = JSON.stringify(value, null, 2)
  return json ?? ''
}

const readField = (event: LedgerEvent, key: string) =>
  (event.data as Record<string, unknown> | undefined)?.[key]

const resourceCount = (event: LedgerEvent) => {
  const resources = readField(event, 'resources')
  return Array.isArray(resources) ? resources.length : 0
}

/** Engine failure codes, in business language. */
const runFailureCopy: Record<string, { title: string; detail: string }> = {
  PLAN_HASH_MISMATCH: {
    title: '运行没有开始',
    detail: '流程在启动前被改过了，请重新检查并测试。',
  },
  RESOURCE_BINDING_MISSING: {
    title: '运行没有开始',
    detail: '缺少这次运行需要的资料，请在设置里补全。',
  },
  STEP_LIMIT_EXCEEDED: {
    title: '运行已停止',
    detail: '执行的步骤数超过了这条流程的上限，可能有来回绕圈的连线。',
  },
  NO_TERMINAL_OUTPUT: {
    title: '运行没有结果',
    detail: '流程走完了，但没有到达「流程结果」这一步。',
  },
  FLOW_STALLED: {
    title: '运行卡住了',
    detail: '没有步骤可以继续，请检查连线和分支条件。',
  },
}

/**
 * Business-language copy for one ledger event. `nodeLabel` is supplied by the
 * caller so this module needs no capability lookups of its own.
 */
export function describeLedgerEvent(
  event: LedgerEvent,
  nodeLabel?: string | null,
): { title: string; detail: string; technical?: string } {
  const named = (suffix: string, fallback: string) =>
    nodeLabel ? `${nodeLabel} ${suffix}` : fallback

  switch (event.type) {
    case 'tool.file.started':
      return { title: '正在提取文件', detail: String(readField(event, 'path') ?? '') }
    case 'tool.file.completed':
      return {
        title: readField(event, 'truncated') ? '文件已提取（已截断）' : '文件已提取',
        detail: `${readField(event, 'path')} · ${readField(event, 'chars')} 字符`,
        technical: formatJson(event.data),
      }
    case 'tool.file.failed':
      return {
        title: '文件提取失败',
        detail: `${readField(event, 'path')}：${(readField(event, 'error') as { message?: string })?.message ?? '解析失败'}`,
        technical: formatJson(event.data),
      }
    case 'tool.result':
      return { title: '文件提取结果', detail: '逐文件结果已保留。' }
    case 'run.started':
      return { title: '运行开始', detail: '已经开始执行这次运行。' }
    case 'run.completed': {
      const output = readField(event, 'outputId')
      return {
        title: '运行完成',
        detail: output === undefined ? '运行已完成。' : `结果：${String(output)}`,
      }
    }
    case 'run.failed': {
      const code = readField(event, 'code')
      const known = typeof code === 'string' ? runFailureCopy[code] : undefined
      if (known) return { ...known, technical: String(code) }
      return { title: '运行失败', detail: '运行没有走完。' }
    }
    case 'run.cancelled':
      return { title: '运行已取消', detail: '这次运行被手动停止。' }
    case 'run.needs-reconciliation': {
      const nodes = readField(event, 'nodes')
      const error = readField(event, 'error')
      if (Array.isArray(nodes))
        return {
          title: '需要人工核对',
          detail: `有 ${nodes.length} 个步骤的结果无法确认，请人工核对后再继续。`,
          technical: formatJson(event.data),
        }
      return {
        title: named('需要人工核对', '需要人工核对'),
        detail: '这一步可能已经产生了影响，但结果没有确认。请人工核对后再继续。',
        technical: error === undefined ? undefined : formatJson(error),
      }
    }
    case 'resources.bound': {
      const count = resourceCount(event)
      return {
        title: '已绑定运行资料',
        detail: count ? `这次运行可以使用 ${count} 项资料。` : '这次运行不需要额外资料。',
        technical: formatJson(event.data),
      }
    }
    case 'resource.access': {
      const count = resourceCount(event)
      return {
        title: named('使用了资料', '使用了资料'),
        detail: count ? `这一步用到了 ${count} 项已授权资料。` : '这一步用到了已授权资料。',
        technical: formatJson(event.data),
      }
    }
    case 'node.started':
      return { title: named('开始', '步骤开始'), detail: '这一步开始执行。' }
    case 'node.completed': {
      const value = readField(event, 'value')
      return {
        title: named('完成', '步骤完成'),
        detail:
          value === undefined || value === null ? '这一步已完成。' : '这一步已完成，产出了结果。',
        technical: value === undefined ? undefined : formatJson(value),
      }
    }
    case 'node.failed': {
      const error = readField(event, 'error')
      if (error === 'UPSTREAM_FAILURE')
        return { title: named('没有执行', '步骤没有执行'), detail: '上一步失败了，这一步被跳过。' }
      return {
        title: named('失败', '步骤失败'),
        detail: error === undefined ? '这一步执行失败。' : `错误：${String(error)}`,
        technical: formatJson(event.data),
      }
    }
    case 'node.inactive':
      return { title: named('未走到', '未走到'), detail: '这次运行没有选中这条路径。' }
    case 'node.blocked':
      return { title: named('走不下去', '走不下去'), detail: '它依赖的上一步没有成功。' }
    case 'node.retry': {
      const attempt = readField(event, 'attempt')
      return {
        title: named('重试', '步骤重试'),
        detail: attempt === undefined ? '正在重试这一步。' : `第 ${String(attempt)} 次尝试。`,
      }
    }
    default:
      // Never surface a raw event type; say only what we honestly know.
      return {
        title: '运行记录',
        detail: '记录了一条运行事实，详情见技术细节。',
        technical: formatJson({ type: event.type, data: event.data }),
      }
  }
}

export function eventTone(event: LedgerEvent): EventTone {
  if (['run.completed', 'node.completed', 'tool.file.completed'].includes(event.type))
    return 'completed'
  if (
    [
      'run.failed',
      'run.cancelled',
      'run.needs-reconciliation',
      'node.failed',
      'node.blocked',
      'tool.file.failed',
    ].includes(event.type)
  )
    return 'failed'
  if (event.type === 'node.inactive') return 'disabled'
  return 'running'
}

const bySeq = (a: LedgerEvent, b: LedgerEvent) => a.seq - b.seq

export function buildRunLog(
  draft: FlowDraft | null,
  run: RunDetail | null,
  cfs: CFVersion[] = [],
  candidateCfs: CFDraft[] = [],
): RunLog | null {
  if (!draft || !run) return null
  const idByIndex = nodeIdByIndex(draft)
  const runGroup: RunLogGroup = {
    key: 'run',
    kind: 'run',
    title: '整条流程',
    firstSeq: Number.POSITIVE_INFINITY,
    lastAt: '',
    entries: [],
  }
  const groups = new Map<number, RunLogGroup>()

  for (const event of [...run.events].sort(bySeq)) {
    const index = event.node
    const nodeId = index == null ? undefined : idByIndex.get(index)
    // A run recorded against an older revision can reference an index the
    // current draft no longer has. Attaching a shifted step's name would be a
    // lie, so mark it stale and keep it unnamed.
    const stale = index != null && nodeId === undefined
    const target =
      index == null
        ? runGroup
        : (groups.get(index) ??
          (() => {
            const node = stale ? undefined : draft.nodes[index]
            const created: RunLogGroup = {
              key: `node-${index}`,
              kind: 'node',
              nodeIndex: index,
              nodeId,
              title: node
                ? describeNode(node, cfs, candidateCfs).label
                : `已改动的步骤（第 ${index + 1} 步）`,
              kindLabel: node ? nodeKindLabel(node.kind) : undefined,
              configNote: node ? nodeConfigNote(node) : undefined,
              firstSeq: event.seq,
              lastAt: event.at,
              ...(stale ? { stale: true } : {}),
              entries: [],
            }
            groups.set(index, created)
            return created
          })())
    const described = describeLedgerEvent(
      event,
      target.kind === 'node' && !stale ? target.title : null,
    )
    target.entries.push({
      seq: event.seq,
      type: event.type,
      at: event.at,
      tone: eventTone(event),
      ...described,
      ...(['node.completed', 'tool.result'].includes(event.type) &&
      (readField(event, 'value') as FileExtractionResult)?.kind === 'file-extraction'
        ? { extraction: readField(event, 'value') as FileExtractionResult }
        : {}),
    })
    target.firstSeq = Math.min(target.firstSeq, event.seq)
    target.lastAt = event.at
    if (target.kind === 'node') {
      const next = foldNodeEventState(target.state, event.type)
      if (next) target.state = next
    }
  }

  const nodes = [...groups.values()].sort((a, b) => a.firstSeq - b.firstSeq)
  nodes.forEach((group, position) => {
    group.order = position + 1
  })
  if (!Number.isFinite(runGroup.firstSeq)) runGroup.firstSeq = 0
  return { run: runGroup, nodes }
}

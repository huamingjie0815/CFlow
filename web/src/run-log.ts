import { describeNode, nodeConfigNote } from './flow-labels'
import { foldNodeEventState, nodeIdByIndex, type NodeRunState } from './run'
import { nodeKindLabel } from './copy'
import { format, messagesFor, type Locale } from './i18n'
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
function runFailureCopy(locale: Locale): Record<string, { title: string; detail: string }> {
  const copy = messagesFor(locale).ledger
  return {
    PLAN_HASH_MISMATCH: copy.noStartHash,
    RESOURCE_BINDING_MISSING: copy.noStartResource,
    STEP_LIMIT_EXCEEDED: copy.stoppedLimit,
    NO_TERMINAL_OUTPUT: copy.noResult,
    FLOW_STALLED: copy.stalled,
  }
}

/**
 * Business-language copy for one ledger event. `nodeLabel` is supplied by the
 * caller so this module needs no capability lookups of its own.
 */
export function describeLedgerEvent(
  event: LedgerEvent,
  nodeLabel?: string | null,
  locale: Locale = 'zh-CN',
): { title: string; detail: string; technical?: string } {
  const copy = messagesFor(locale).ledger
  const named = (suffix: string, fallback: string) =>
    nodeLabel ? `${nodeLabel} ${suffix}` : fallback

  switch (event.type) {
    case 'tool.file.started':
      return { title: copy.extracting, detail: String(readField(event, 'path') ?? '') }
    case 'tool.file.completed':
      return {
        title: readField(event, 'truncated') ? copy.extractedTruncated : copy.extracted,
        detail: format(copy.chars, {
          path: String(readField(event, 'path') ?? ''),
          chars: String(readField(event, 'chars') ?? ''),
        }),
        technical: formatJson(event.data),
      }
    case 'tool.file.failed':
      return {
        title: copy.extractFailed,
        detail: format(copy.extractFailedDetail, {
          path: String(readField(event, 'path') ?? ''),
          error: String(
            (readField(event, 'error') as { message?: string })?.message ?? copy.parseFailed,
          ),
        }),
        technical: formatJson(event.data),
      }
    case 'tool.result':
      return { title: copy.extractResult.title, detail: copy.extractResult.detail }
    case 'run.started':
      return { title: copy.runStarted.title, detail: copy.runStarted.detail }
    case 'run.completed': {
      const output = readField(event, 'outputId')
      return {
        title: copy.runCompleted,
        detail:
          output === undefined
            ? copy.runCompletedPlain
            : format(copy.result, { value: String(output) }),
      }
    }
    case 'run.failed': {
      const code = readField(event, 'code')
      const known = typeof code === 'string' ? runFailureCopy(locale)[code] : undefined
      if (known) return { ...known, technical: String(code) }
      return { title: copy.runFailed.title, detail: copy.runFailed.detail }
    }
    case 'run.cancelled':
      return { title: copy.cancelled.title, detail: copy.cancelled.detail }
    case 'run.needs-reconciliation': {
      const nodes = readField(event, 'nodes')
      const error = readField(event, 'error')
      if (Array.isArray(nodes))
        return {
          title: copy.reconcile,
          detail: format(copy.reconcileMany, { count: nodes.length }),
          technical: formatJson(event.data),
        }
      return {
        title: named(copy.reconcile, copy.reconcile),
        detail: copy.reconcileOne,
        technical: error === undefined ? undefined : formatJson(error),
      }
    }
    case 'resources.bound': {
      const count = resourceCount(event)
      return {
        title: copy.bound,
        detail: count ? format(copy.boundSome, { count }) : copy.boundNone,
        technical: formatJson(event.data),
      }
    }
    case 'resource.access': {
      const count = resourceCount(event)
      return {
        title: named(copy.used, copy.used),
        detail: count ? format(copy.usedSome, { count }) : copy.usedNone,
        technical: formatJson(event.data),
      }
    }
    case 'node.started':
      return { title: named(copy.started, copy.stepStarted), detail: copy.startedDetail }
    case 'node.completed': {
      const value = readField(event, 'value')
      return {
        title: named(copy.completed, copy.stepCompleted),
        detail:
          value === undefined || value === null ? copy.completedPlain : copy.completedWithResult,
        technical: value === undefined ? undefined : formatJson(value),
      }
    }
    case 'node.failed': {
      const error = readField(event, 'error')
      if (error === 'UPSTREAM_FAILURE')
        return { title: named(copy.skipped, copy.stepSkipped), detail: copy.skippedDetail }
      return {
        title: named(copy.failed, copy.stepFailed),
        detail:
          error === undefined
            ? copy.failedPlain
            : format(copy.failedDetail, { error: String(error) }),
        technical: formatJson(event.data),
      }
    }
    case 'node.inactive':
      return { title: named(copy.inactive, copy.inactive), detail: copy.inactiveDetail }
    case 'node.blocked':
      return { title: named(copy.blocked, copy.blocked), detail: copy.blockedDetail }
    case 'node.retry': {
      const attempt = readField(event, 'attempt')
      return {
        title: named(copy.retry, copy.stepRetry),
        detail:
          attempt === undefined ? copy.retrying : format(copy.attempt, { n: String(attempt) }),
      }
    }
    default:
      // Never surface a raw event type; say only what we honestly know.
      return {
        title: copy.record.title,
        detail: copy.record.detail,
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
  locale: Locale = 'zh-CN',
): RunLog | null {
  if (!draft || !run) return null
  const idByIndex = nodeIdByIndex(draft)
  const copy = messagesFor(locale).ledger
  const runGroup: RunLogGroup = {
    key: 'run',
    kind: 'run',
    title: copy.wholeFlow,
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
                ? describeNode(node, cfs, candidateCfs, locale).label
                : format(copy.staleStep, { n: index + 1 }),
              kindLabel: node ? nodeKindLabel(node.kind, locale) : undefined,
              configNote: node ? nodeConfigNote(node, locale) : undefined,
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
      locale,
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

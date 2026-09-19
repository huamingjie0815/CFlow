import { joinModeLabel } from './copy'
import { format, messagesFor, type Locale } from './i18n'
import type { CFDraft, CFVersion, FlowDraft, FlowNode } from './types'

/**
 * Turns Flow structure into the words a non-technical colleague reads.
 *
 * The product rule these functions enforce: no internal identifier (cfId,
 * version, outputId, branch case id) ever becomes primary reading
 * matter. Identifiers stay available through the inspector's technical
 * disclosure, never as a node title or an edge label.
 */

export type NodeCopy = { label: string; subtitle: string }

export function describeNode(
  node: FlowNode,
  cfs: CFVersion[],
  candidates: CFDraft[],
  locale: Locale = 'zh-CN',
): NodeCopy {
  const copy = messagesFor(locale).labels
  if (node.kind === 'cf-call') {
    // The name the author typed always wins over any looked-up identifier.
    const nodeName = node.name?.trim()
    if (!node.cfRef.cfId || !node.cfRef.version)
      return { label: nodeName || copy.emptyStep, subtitle: copy.noTask }
    const draft = candidates.find((item) => item.cfId === node.cfRef.cfId)
    const version = cfs.find(
      (item) => item.cfId === node.cfRef.cfId && item.version === node.cfRef.version,
    )
    return {
      label: nodeName || draft?.name?.trim() || version?.draft.name?.trim() || copy.emptyStep,
      subtitle: draft?.does?.trim() || version?.draft.does?.trim() || copy.emptyHint,
    }
  }
  if (node.kind === 'branch')
    return {
      label: copy.branch,
      // Show the routing rules the author wrote, not the case ids.
      subtitle:
        node.cases.map((caseId) => node.caseConditions?.[caseId]?.trim() || caseId).join(' · ') ||
        copy.noConditions,
    }
  if (node.kind === 'join') return { label: copy.join, subtitle: joinModeLabel(node.mode, locale) }
  return { label: copy.output, subtitle: copy.outputHint }
}

export function edgeLabel(
  edge: FlowDraft['edges'][number],
  nodes: FlowNode[],
  locale: Locale = 'zh-CN',
): string | undefined {
  const copy = messagesFor(locale).labels
  if (!edge.when) return undefined
  if (edge.when.outcome === 'branch-case') {
    const caseId = edge.when.caseId
    if (!caseId) return copy.branchEdge
    const source = nodes.find((node) => node.id === edge.from)
    const condition =
      source?.kind === 'branch' ? source.caseConditions?.[caseId]?.trim() : undefined
    return condition || caseId
  }
  if (edge.when.outcome === 'completed') return copy.completed
  if (edge.when.outcome === 'failed') return copy.failed
  return edge.when.outcome
}

/** The quiet chip under a step card: retry policy, else which agent runs it. */
export function nodeConfigNote(node: FlowNode, locale: Locale = 'zh-CN'): string | undefined {
  const copy = messagesFor(locale).labels
  if (node.kind !== 'cf-call') return undefined
  if (node.cfRef.cfId.startsWith('builtin:')) return copy.localParse
  if (node.onError?.action === 'retry')
    return format(copy.retry, { count: node.onError.maxAttempts ?? 1 })
  if (node.executor === 'cflow-demo') return copy.demo
  return node.executor ? format(copy.executor, { name: node.executor }) : undefined
}

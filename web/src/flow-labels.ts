import { joinModeLabel } from './copy'
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

const EMPTY_STEP = '新步骤'
const EMPTY_STEP_HINT = '还没有填写这一步要做什么'

export function describeNode(node: FlowNode, cfs: CFVersion[], candidates: CFDraft[]): NodeCopy {
  if (node.kind === 'cf-call') {
    // The name the author typed always wins over any looked-up identifier.
    const nodeName = node.name?.trim()
    if (!node.cfRef.cfId || !node.cfRef.version)
      return { label: nodeName || EMPTY_STEP, subtitle: '还没有选择要做的事' }
    const draft = candidates.find((item) => item.cfId === node.cfRef.cfId)
    const version = cfs.find(
      (item) => item.cfId === node.cfRef.cfId && item.version === node.cfRef.version,
    )
    return {
      label: nodeName || draft?.name?.trim() || version?.draft.name?.trim() || EMPTY_STEP,
      subtitle: draft?.does?.trim() || version?.draft.does?.trim() || EMPTY_STEP_HINT,
    }
  }
  if (node.kind === 'branch')
    return {
      label: '条件分支',
      // Show the routing rules the author wrote, not the case ids.
      subtitle:
        node.cases.map((caseId) => node.caseConditions?.[caseId]?.trim() || caseId).join(' · ') ||
        '还没有写分支条件',
    }
  if (node.kind === 'join') return { label: '汇合', subtitle: joinModeLabel(node.mode) }
  return { label: '流程结果', subtitle: '流程走到这里就结束' }
}

const outcomeLabels: Record<string, string> = {
  completed: '完成',
  failed: '失败',
}

export function edgeLabel(edge: FlowDraft['edges'][number], nodes: FlowNode[]): string | undefined {
  if (!edge.when) return undefined
  if (edge.when.outcome === 'branch-case') {
    const caseId = edge.when.caseId
    if (!caseId) return '分支'
    const source = nodes.find((node) => node.id === edge.from)
    const condition =
      source?.kind === 'branch' ? source.caseConditions?.[caseId]?.trim() : undefined
    return condition || caseId
  }
  return outcomeLabels[edge.when.outcome] ?? edge.when.outcome
}

/** The quiet chip under a step card: retry policy, else which agent runs it. */
export function nodeConfigNote(node: FlowNode): string | undefined {
  if (node.kind !== 'cf-call') return undefined
  if (node.cfRef.cfId.startsWith('builtin:')) return '本地解析'
  if (node.onError?.action === 'retry') return `失败时重试 ${node.onError.maxAttempts ?? 1} 次`
  if (node.executor === 'cflow-demo') return '演示执行，不调用本机助手'
  return node.executor ? `由 ${node.executor} 执行` : undefined
}

import { sha256 } from './hash.js'
import { assertContractSchema } from './contract.js'
import { assertUserCapability } from './builtin-catalog.js'
import { assertExtractionInput } from './file-extraction-config.js'
import type { CFDraft, CFVersion, FlowDraft, FlowEdge, FlowPlan } from './types.js'

type NormalizedFlowEdge = Omit<FlowEdge, 'from' | 'to'> & {
  from: number | '$entry'
  to: number
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
export function assertFileReferences(fileReferences: string[] | undefined) {
  if (!fileReferences) return
  assert(fileReferences.length <= 100, 'CF_FILE_REFERENCES_LIMIT')
  const seen = new Set<string>()
  for (const path of fileReferences) {
    assert(
      typeof path === 'string' && path.length > 0 && path.length <= 1024,
      'CF_FILE_PATH_INVALID',
    )
    assert(
      !path.startsWith('/') && !path.startsWith('\\') && !/^[A-Za-z]:/.test(path),
      'CF_FILE_PATH_INVALID',
    )
    const parts = path.split('/')
    assert(
      parts.every((part) => part.length > 0 && part !== '.' && part !== '..'),
      'CF_FILE_PATH_INVALID',
    )
    assert(!path.includes('\\') && !seen.has(path), 'CF_FILE_PATH_INVALID')
    seen.add(path)
  }
}
function checkGraph(
  nodes: number[],
  edges: { from: number | string; to: number }[],
  entries: number[],
) {
  const adj = new Map<number, number[]>()
  for (const i of nodes) adj.set(i, [])
  for (const e of edges) if (typeof e.from === 'number') adj.get(e.from)!.push(e.to)
  const seen = new Set<number>(),
    visiting = new Set<number>()
  const visit = (n: number) => {
    if (visiting.has(n)) throw new Error('NON_TERMINATING_PATH: cycle')
    if (seen.has(n)) return
    visiting.add(n)
    for (const x of adj.get(n) ?? []) visit(x)
    visiting.delete(n)
    seen.add(n)
  }
  entries.forEach(visit)
  assert(seen.size === nodes.length, 'UNREACHABLE_NODE: all nodes must be reachable')
}
export function compileCF(draft: CFDraft): CFVersion {
  assertUserCapability(draft)
  assertFileReferences(draft.fileReferences)
  if (draft.effects) {
    const validTypes = new Set(['file-read', 'file-write', 'command'])
    for (const effect of draft.effects) {
      assert(validTypes.has(effect.type), 'CF_EFFECT_TYPE_INVALID')
      assert(effect.scope === 'workspace', 'CF_EFFECT_SCOPE_INVALID')
      assert(
        typeof effect.description === 'string' && effect.description.trim().length > 0,
        'CF_EFFECT_DESCRIPTION_REQUIRED',
      )
    }
  }
  const inputContract = draft.inputContract ?? { type: 'object' }
  const outputContract = draft.outputContract ?? { type: 'object' }
  assertContractSchema(inputContract, 'CF_INPUT')
  assertContractSchema(outputContract, 'CF_OUTPUT')
  assert(draft.does.trim().length > 0, 'CF_DOES_REQUIRED')
  const hasFileAccess = (draft.effects ?? []).some(
    (effect) => effect.type === 'file-read' || effect.type === 'file-write',
  )
  const fileReferenceGuidance =
    hasFileAccess && draft.fileReferences?.length
      ? [
          'Indexed workspace files (priority order):',
          ...draft.fileReferences.map((path, index) => `${index + 1}. ${path}`),
          '',
          'File resolution rules:',
          '- Resolve an explicit @{relative/path} against the indexed paths first.',
          '- Resolve a mentioned relative path, filename, or basename against the indexed paths before searching elsewhere.',
          '- When more than one indexed file matches, use the first matching indexed path in the order above.',
          '- If no indexed path matches, search the workspace for the mentioned file.',
          '- Use only files required by the task. These paths are location hints; no file contents are embedded here.',
        ].join('\n')
      : undefined
  const task = [
    draft.does.trim(),
    fileReferenceGuidance,
    draft.input?.trim() ? `Input guidance: ${draft.input.trim()}` : undefined,
    draft.output?.trim() ? `Output guidance: ${draft.output.trim()}` : undefined,
    draft.process?.trim() ? `Process constraints: ${draft.process.trim()}` : undefined,
  ]
    .filter(Boolean)
    .join('\n')
  const program = {
    version: '0.2' as const,
    cfId: draft.cfId,
    sourceRevision: draft.revision,
    task,
  }
  const normalizedDraft = { ...draft, inputContract, outputContract }
  return {
    cfId: draft.cfId,
    version: `${draft.revision}.0.0`,
    draft: normalizedDraft,
    program,
    programHash: sha256({ inputContract, outputContract, program }),
    createdAt: new Date().toISOString(),
  }
}
export function compileFlow(
  draft: FlowDraft,
  versions: Map<string, CFVersion>,
  options: { allowUnconfiguredTools?: boolean; flowVersion?: string } = {},
): FlowPlan {
  assert(draft.workspaceRoot?.trim().length > 0, 'FLOW_WORKSPACE_REQUIRED')
  assert(draft.nodes.length > 0, 'FLOW_EMPTY')
  assert((draft.limits?.maxConcurrency ?? 2) > 0, 'FLOW_INVALID_CONCURRENCY')
  assert((draft.limits?.maxNodeDispatches ?? 32) > 0, 'FLOW_INVALID_DISPATCH_LIMIT')
  const ids = new Set<string>()
  const nodeKinds = new Set(['cf-call', 'branch', 'join', 'output'])
  draft.nodes.forEach((n) => {
    assert(nodeKinds.has(n.kind), `FLOW_NODE_KIND_INVALID:${n.kind}`)
    assert(n.id.trim().length > 0, 'FLOW_NODE_ID_REQUIRED')
    assert(!ids.has(n.id), 'FLOW_DUPLICATE_NODE')
    ids.add(n.id)
    if (n.kind === 'cf-call') {
      assert(
        versions.has(`${n.cfRef.cfId}@${n.cfRef.version}`),
        `UNKNOWN_CF:${n.cfRef.cfId}@${n.cfRef.version}`,
      )
      assertContractSchema(n.inputContract, `FLOW_INPUT_${n.id}`)
      assertContractSchema(n.outputContract, `FLOW_OUTPUT_${n.id}`)
      const version = versions.get(`${n.cfRef.cfId}@${n.cfRef.version}`)!
      if (version.program.version === '0.3') {
        if (
          options.allowUnconfiguredTools &&
          (!n.toolInput ||
            (n.toolInput.source.kind === 'files' && !n.toolInput.source.paths.length))
        )
          return
        assertExtractionInput(n.toolInput)
        if (n.toolInput.source.kind === 'files')
          assertFileReferences([...new Set(n.toolInput.source.paths)])
        if (n.toolInput.source.kind === 'upstream') {
          const sourceId = n.toolInput.source.nodeId
          assert(
            draft.edges.some((edge) => edge.from === sourceId && edge.to === n.id),
            `文件来源必须是直接上游步骤：${n.id}`,
          )
        }
      } else assert(n.toolInput === undefined, '普通 Agent 能力不支持内置工具配置。')
    }
  })
  const index = new Map(draft.nodes.map((n, i) => [n.id, i]))
  const entries = draft.edges
    .filter((e) => e.from === '$entry')
    .map((e) => index.get(e.to)!)
    .filter((n): n is number => n !== undefined)
  assert(entries.length > 0, 'FLOW_NO_ENTRY')
  const edgeIds = new Set<string>()
  const edges: NormalizedFlowEdge[] = draft.edges.map((e) => {
    assert(
      !e.when || ['completed', 'failed', 'branch-case'].includes(e.when.outcome),
      `FLOW_EDGE_OUTCOME_INVALID:${e.when?.outcome}`,
    )
    assert(e.id.trim().length > 0, 'FLOW_EDGE_ID_REQUIRED')
    assert(!edgeIds.has(e.id), 'FLOW_DUPLICATE_EDGE')
    edgeIds.add(e.id)
    const to = index.get(e.to)
    assert(to !== undefined, `BAD_EDGE_TO:${e.to}`)
    const from = e.from === '$entry' ? '$entry' : index.get(e.from)
    assert(from !== undefined, `BAD_EDGE_FROM:${e.from}`)
    return { ...e, from, to }
  })
  checkGraph([...index.values()], edges, entries)
  assert(
    draft.nodes.some((n) => n.kind === 'output'),
    'FLOW_NO_OUTPUT',
  )
  for (const node of draft.nodes) {
    const outgoing = edges.filter((edge) => edge.from === index.get(node.id))
    if (node.kind === 'output') assert(outgoing.length === 0, 'OUTPUT_MUST_BE_TERMINAL')
    else assert(outgoing.length > 0, `NON_TERMINAL_NODE:${node.id}`)
    if (node.kind === 'branch') {
      assert(node.cases.length > 0, `BRANCH_CASES_REQUIRED:${node.id}`)
      assert(
        new Set(node.cases).size === node.cases.length &&
          node.cases.every((caseId) => caseId.trim().length > 0),
        `BRANCH_CASE_IDS_INVALID:${node.id}`,
      )
      if (node.caseConditions)
        for (const caseId of node.cases)
          assert(
            node.caseConditions[caseId]?.trim().length,
            `BRANCH_CONDITION_REQUIRED:${node.id}:${caseId}`,
          )
      const cases = outgoing.map((edge) =>
        edge.when?.outcome === 'branch-case' ? edge.when.caseId : undefined,
      )
      assert(
        cases.every(Boolean) &&
          new Set(cases).size === node.cases.length &&
          node.cases.every((caseId) => cases.includes(caseId)),
        `BRANCH_CASES_INCOMPLETE:${node.id}`,
      )
    }
  }
  for (const e of edges) {
    if (e.when?.outcome === 'branch-case') {
      const source = typeof e.from === 'number' ? draft.nodes[e.from] : undefined
      assert(source?.kind === 'branch', 'BRANCH_EDGE_SOURCE_REQUIRED')
      assert(source.cases.includes(e.when.caseId ?? ''), 'UNKNOWN_BRANCH_CASE')
    }
  }
  if (draft.resources) {
    const requirementIds = new Set<string>()
    for (const requirement of draft.resources) {
      assert(requirement.id.trim().length > 0, 'RESOURCE_REQUIREMENT_ID_REQUIRED')
      assert(!requirementIds.has(requirement.id), 'DUPLICATE_RESOURCE_REQUIREMENT')
      requirementIds.add(requirement.id)
      assert(requirement.type.trim().length > 0, `RESOURCE_TYPE_REQUIRED:${requirement.id}`)
    }
  }
  const nodes = draft.nodes.map((n, i) => ({
    ...n,
    index: i,
    ...(n.kind === 'cf-call'
      ? { programHash: versions.get(`${n.cfRef.cfId}@${n.cfRef.version}`)!.programHash }
      : {}),
  }))
  for (const node of nodes) {
    if (
      node.kind === 'cf-call' &&
      versions.get(`${node.cfRef.cfId}@${node.cfRef.version}`)?.program.version === '0.3'
    )
      delete node.executor
  }
  const base = {
    version: '0.6' as const,
    flowId: draft.flowId,
    flowVersion: options.flowVersion ?? '1.0.0',
    objective: draft.objective,
    workspaceRoot: draft.workspaceRoot,
    entries,
    nodes,
    edges,
    ...(draft.resources ? { resources: draft.resources } : {}),
    limits: {
      maxConcurrency: draft.limits?.maxConcurrency ?? 2,
      maxNodeDispatches: draft.limits?.maxNodeDispatches ?? 32,
    },
  }
  return { ...base, planHash: sha256(base) } as FlowPlan
}

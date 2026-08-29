import { sha256 } from './hash.js'
import { assertContractSchema } from './contract.js'
import type { CFDraft, CFVersion, FlowDraft, FlowEdge, FlowPlan } from './types.js'

type NormalizedFlowEdge = Omit<FlowEdge, 'from' | 'to'> & {
  from: number | '$entry'
  to: number
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
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
  const task = [
    draft.does.trim(),
    draft.input?.trim() ? `Input guidance: ${draft.input.trim()}` : undefined,
    draft.output?.trim() ? `Output guidance: ${draft.output.trim()}` : undefined,
    draft.process?.trim() ? `Process constraints: ${draft.process.trim()}` : undefined,
  ]
    .filter(Boolean)
    .join('\n')
  const program = draft.program ?? {
    version: '0.1' as const,
    cfId: draft.cfId,
    sourceRevision: draft.revision,
    entry: 0,
    steps: [
      { index: 0, kind: 'agent' as const, task, input: '$inputContext', next: 1 },
      { index: 1, kind: 'return' as const, source: '$local.0.output' },
    ],
    limits: { maxStepExecutions: 8, maxExternalCalls: 2, maxOutputBytes: 65536 },
  }
  const indexes = new Set(program.steps.map((s) => s.index))
  assert(program.steps.length > 0, 'CF_EMPTY_PROGRAM')
  assert(program.limits.maxStepExecutions > 0, 'CF_INVALID_STEP_LIMIT')
  assert(program.limits.maxExternalCalls >= 0, 'CF_INVALID_EXTERNAL_CALL_LIMIT')
  assert(program.limits.maxOutputBytes > 0, 'CF_INVALID_OUTPUT_LIMIT')
  assert(indexes.size === program.steps.length, 'CF_DUPLICATE_STEP')
  assert(indexes.has(program.entry), 'CF_BAD_ENTRY')
  const returns = program.steps.filter((s) => s.kind === 'return')
  assert(returns.length > 0, 'CF_NO_RETURN')
  const nextEdges = program.steps.flatMap((s) =>
    s.kind === 'guard'
      ? [
          { from: s.index, to: s.then },
          { from: s.index, to: s.else },
        ]
      : s.kind === 'return'
        ? []
        : [{ from: s.index, to: s.next! }],
  )
  for (const e of nextEdges) assert(indexes.has(e.to), 'CF_BAD_NEXT')
  checkGraph([...indexes], nextEdges, [program.entry])
  const normalizedDraft = { ...draft, inputContract, outputContract, program }
  return {
    cfId: draft.cfId,
    version: `${draft.revision}.0.0`,
    draft: normalizedDraft,
    program,
    programHash: sha256({ inputContract, outputContract, program }),
    createdAt: new Date().toISOString(),
  }
}
export function compileFlow(draft: FlowDraft, versions: Map<string, CFVersion>): FlowPlan {
  assert(draft.nodes.length > 0, 'FLOW_EMPTY')
  assert((draft.limits?.maxConcurrency ?? 2) > 0, 'FLOW_INVALID_CONCURRENCY')
  assert((draft.limits?.maxNodeDispatches ?? 32) > 0, 'FLOW_INVALID_DISPATCH_LIMIT')
  const ids = new Set<string>()
  draft.nodes.forEach((n) => {
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
    if (e.when?.outcome === 'approved' || e.when?.outcome === 'rejected') {
      const source = typeof e.from === 'number' ? draft.nodes[e.from] : undefined
      assert(source?.kind === 'approval', 'APPROVAL_EDGE_SOURCE_REQUIRED')
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
  const adjacency = new Map<number, number[]>()
  for (const i of index.values()) adjacency.set(i, [])
  for (const edge of edges)
    if (typeof edge.from === 'number') adjacency.get(edge.from)!.push(edge.to)
  const reaches = (from: number, to: number) => {
    const seen = new Set<number>()
    const visit = (n: number): boolean => {
      if (n === to) return true
      if (seen.has(n)) return false
      seen.add(n)
      return (adjacency.get(n) ?? []).some(visit)
    }
    return visit(from)
  }
  const nodes = draft.nodes.map((n, i) => ({
    ...n,
    index: i,
    ...(n.kind === 'cf-call'
      ? { programHash: versions.get(`${n.cfRef.cfId}@${n.cfRef.version}`)!.programHash }
      : {}),
  }))
  const base = {
    version: '0.5' as const,
    flowId: draft.flowId,
    flowVersion: `${draft.revision}.0.0`,
    objective: draft.objective,
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

import test from 'node:test'
import assert from 'node:assert/strict'
import { compileCF, compileFlow } from './compiler.js'
import {
  applyFlowRevision,
  assertAttachmentGrounding,
  buildProposalGraph,
  flowRevisionOutputSchema,
  matchPublishedCapabilities,
  normalizeEffects,
} from './proposal.js'
import type { CFDraft, CFVersion, FlowDraft } from './types.js'

const published = compileCF({
  cfId: 'summarize',
  revision: 1,
  name: 'Summarize',
  does: 'summarize a report',
})

const stage = (name: string, extra: object = {}) => ({
  kind: 'cf-call',
  name,
  does: `do ${name}`,
  cfId: null,
  ...extra,
})

test('revision schema allows branch stages and uses a consistent nested capability shape', () => {
  const schema = flowRevisionOutputSchema(false) as any
  const stageItem = schema.properties.stages.items
  assert.deepEqual(stageItem.properties.kind.enum, ['cf-call', 'branch'])
  const nestedCapability = stageItem.properties.routes.items.properties.stages.items
  assert.ok(nestedCapability.required.includes('cond'))
  assert.ok(nestedCapability.required.includes('routes'))
  assert.equal(nestedCapability.properties.cond.type, 'null')
  assert.equal(nestedCapability.properties.routes.maxItems, 0)
})

/** Compiles a proposed graph so the plan invariants are the real assertion. */
function compileProposal(graph: ReturnType<typeof buildProposalGraph>, extra: CFVersion[] = []) {
  const draft: FlowDraft = {
    flowId: 'proposed',
    revision: 1,
    name: 'Proposed',
    objective: 'run',
    workspaceRoot: process.cwd(),
    nodes: graph.nodes,
    edges: graph.edges,
  }
  const versions = [...extra, ...graph.cfDrafts.map((cf) => compileCF(cf))]
  return compileFlow(draft, new Map(versions.map((v) => [`${v.cfId}@${v.version}`, v])))
}

test('builds a linear proposal that compiles to a valid plan', () => {
  const graph = buildProposalGraph([stage('collect'), stage('review')], {
    catalog: [],
    runtimeId: 'codex',
  })
  assert.equal(graph.cfDrafts.length, 2)
  assert.equal(graph.nodes.at(-1)?.kind, 'output')
  assert.equal(graph.cfDrafts[0].defaultExecutor, 'codex')
  const plan = compileProposal(graph)
  assert.equal(plan.entries.length, 1)
  assert.equal(plan.nodes.length, 3)
})

test('reuses a published capability instead of drafting a new one', () => {
  const graph = buildProposalGraph([stage('anything', { cfId: 'summarize' })], {
    catalog: [published],
  })
  assert.equal(graph.cfDrafts.length, 0)
  const node = graph.nodes[0]
  assert.equal(node.kind === 'cf-call' && node.cfRef.version, published.version)
  // No runtime was requested, so the node must not pin an executor.
  assert.equal((node as { executor?: string }).executor, undefined)
  compileProposal(graph, [published])
})

test('fans a branch out to every route and re-converges on the next stage', () => {
  const graph = buildProposalGraph(
    [
      stage('triage'),
      {
        kind: 'branch',
        name: 'route by risk',
        cond: 'risk',
        routes: [
          { caseId: 'high', condition: '高风险', endsFlow: false, stages: [stage('escalate')] },
          { caseId: 'low', condition: '低风险', endsFlow: false, stages: [stage('auto-close')] },
        ],
      },
      stage('report'),
    ],
    { catalog: [], runtimeId: 'codex' },
  )
  const branch = graph.nodes.find((node) => node.kind === 'branch')
  assert.ok(branch && branch.kind === 'branch')
  assert.deepEqual(branch.cases, ['high', 'low'])
  assert.equal(branch.caseConditions?.high, '高风险')
  const plan = compileProposal(graph)
  // Both routes converge on the shared report step, which then reaches output.
  const report = plan.nodes.find((node) => node.kind === 'cf-call' && node.index === 4)
  assert.ok(report)
  const intoReport = plan.edges.filter((edge) => edge.to === report!.index)
  assert.equal(intoReport.length, 2)
  assert.equal(plan.edges.filter((e) => e.when?.outcome === 'branch-case').length, 2)
})

test('allows a branch route to end the Flow immediately', () => {
  const graph = buildProposalGraph(
    [
      {
        kind: 'branch',
        name: '是否需要继续处理',
        cond: 'decision',
        routes: [
          { caseId: 'done', condition: '条件已满足，直接结束流程', stages: [], endsFlow: true },
          {
            caseId: 'continue',
            condition: '仍需处理',
            endsFlow: false,
            stages: [stage('继续处理')],
          },
        ],
      },
    ],
    { catalog: [], runtimeId: 'codex' },
  )

  const output = graph.nodes.at(-1)
  assert.equal(output?.kind, 'output')
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.from === 'branch-1' &&
        edge.to === output?.id &&
        edge.when?.outcome === 'branch-case' &&
        edge.when.caseId === 'done',
    ),
  )
  compileProposal(graph)
})

test('rejects malformed branches', () => {
  const branch = (routes: unknown) => () =>
    buildProposalGraph([{ kind: 'branch', name: 'b', cond: 'x', routes }], { catalog: [] })
  assert.throws(
    branch([{ caseId: 'only', condition: 'c', endsFlow: false, stages: [stage('a')] }]),
    /ROUTES_INVALID/,
  )
  assert.throws(
    branch([
      { caseId: 'dup', condition: 'c', endsFlow: false, stages: [stage('a')] },
      { caseId: 'dup', condition: 'c', endsFlow: false, stages: [stage('b')] },
    ]),
    /BRANCH_CASE_INVALID/,
  )
  assert.throws(
    branch([
      { caseId: 'a', condition: 'c', endsFlow: false, stages: [] },
      { caseId: 'b', condition: 'c', endsFlow: false, stages: [stage('b')] },
    ]),
    /BRANCH_ROUTE_EMPTY/,
  )
  assert.throws(
    branch([
      { caseId: 'a', condition: 'c', endsFlow: true, stages: [stage('must-not-run')] },
      { caseId: 'b', condition: 'c', endsFlow: false, stages: [stage('b')] },
    ]),
    /BRANCH_ROUTE_TERMINAL_WITH_STAGES/,
  )
  assert.throws(
    () =>
      buildProposalGraph(
        [
          {
            kind: 'branch',
            name: 'stop',
            cond: 'route',
            routes: [
              { caseId: 'a', condition: 'a', endsFlow: true, stages: [] },
              { caseId: 'b', condition: 'b', endsFlow: true, stages: [] },
            ],
          },
          stage('unreachable'),
        ],
        { catalog: [] },
      ),
    /RUNTIME_PROPOSAL_AFTER_TERMINAL_BRANCH/,
  )
})

test('rejects an empty stage list and a nameless stage', () => {
  assert.throws(() => buildProposalGraph([], { catalog: [] }), /RUNTIME_PROPOSAL_EMPTY/)
  assert.throws(
    () => buildProposalGraph([{ kind: 'cf-call', name: '', does: 'x' }], { catalog: [] }),
    /RUNTIME_PROPOSAL_STAGE_INVALID/,
  )
})

test('grounding requires every stage, nested routes included, to quote the source', () => {
  const contents = [
    { path: 'SKILL.md', content: 'First collect the data.\nThen escalate high risk.' },
  ]
  assert.doesNotThrow(() =>
    assertAttachmentGrounding(
      {
        stages: [
          { sourceQuote: 'First collect the data.' },
          {
            sourceQuote: 'Then escalate',
            routes: [
              {
                sourceQuote: 'high risk',
                stages: [{ sourceQuote: 'escalate high risk' }],
              },
            ],
          },
        ],
      },
      contents,
    ),
  )
  assert.throws(
    () =>
      assertAttachmentGrounding(
        {
          stages: [
            {
              sourceQuote: 'Then escalate',
              routes: [{ sourceQuote: 'invented terminal condition', stages: [] }],
            },
          ],
        },
        contents,
      ),
    /RUNTIME_PROPOSAL_UNGROUNDED:2/,
  )
  assert.throws(
    () => assertAttachmentGrounding({ stages: [{ sourceQuote: 'invented text' }] }, contents),
    /RUNTIME_PROPOSAL_UNGROUNDED:1/,
  )
  assert.throws(
    () =>
      assertAttachmentGrounding(
        { stages: [{ sourceQuote: 'First collect the data.' }, { sourceQuote: null }] },
        contents,
      ),
    /RUNTIME_PROPOSAL_UNGROUNDED:2/,
  )
})

test('keeps only valid workspace effects', () => {
  assert.equal(normalizeEffects('nope'), undefined)
  assert.equal(normalizeEffects([{ type: 'network', description: 'x' }]), undefined)
  assert.deepEqual(normalizeEffects([{ type: 'file-write', description: ' write report ' }]), [
    { type: 'file-write', scope: 'workspace', description: 'write report' },
  ])
})

test('matches published capabilities by objective overlap', () => {
  const catalog = [published]
  assert.equal(matchPublishedCapabilities('summarize a report', catalog).length, 1)
  assert.equal(matchPublishedCapabilities('unrelated words', catalog).length, 0)
})

test('a proposed CF draft compiles to a single-capability program', () => {
  const graph = buildProposalGraph(
    [stage('collect', { input: 'raw rows', output: 'clean rows' })],
    {
      catalog: [],
    },
  )
  const version = compileCF(graph.cfDrafts[0] as CFDraft)
  assert.equal(version.program.version, '0.2')
  assert.match(version.program.task, /do collect/)
  assert.match(version.program.task, /Input guidance: raw rows/)
})

test('revises an existing flow in place as a linear graph', () => {
  const candidate: CFDraft = {
    cfId: 'review-draft',
    revision: 2,
    name: 'Review',
    does: 'review the summary',
    output: 'review result',
    defaultExecutor: 'claude',
  }
  const current: FlowDraft = {
    flowId: 'existing-flow',
    revision: 4,
    name: 'Existing',
    objective: 'keep metadata',
    workspaceRoot: process.cwd(),
    resources: [{ id: 'source', type: 'folder', access: 'read', required: true }],
    limits: { maxConcurrency: 1 },
    nodes: [
      {
        id: 'published-step',
        kind: 'cf-call',
        cfRef: { cfId: published.cfId, version: published.version },
        executor: 'codex',
        onError: { action: 'retry', maxAttempts: 3 },
      },
      {
        id: 'draft-step',
        kind: 'cf-call',
        cfRef: { cfId: candidate.cfId, version: '2.0.0' },
        executor: 'claude',
      },
      { id: 'old-branch', kind: 'branch', cond: true, cases: ['yes', 'no'] },
      { id: 'result-node', kind: 'output', outputId: 'final' },
    ],
    edges: [],
  }
  const result = applyFlowRevision(
    current,
    [candidate],
    [
      stage(published.draft.name, { does: published.draft.does, cfId: published.cfId }),
      stage('Review', {
        does: 'review the summary carefully',
        cfId: candidate.cfId,
        output: 'review result',
      }),
      stage('Publish'),
    ],
    { catalog: [published], runtimeId: 'codex' },
  )

  assert.equal(result.flowDraft.flowId, current.flowId)
  assert.equal(result.flowDraft.workspaceRoot, current.workspaceRoot)
  assert.equal(result.flowDraft.revision, 5)
  assert.deepEqual(result.flowDraft.resources, current.resources)
  assert.deepEqual(result.flowDraft.limits, current.limits)
  assert.deepEqual(
    result.flowDraft.nodes.map((node) => [node.id, node.kind]),
    [
      ['published-step', 'cf-call'],
      ['draft-step', 'cf-call'],
      ['step-3', 'cf-call'],
      ['result-node', 'output'],
    ],
  )
  const calls = result.flowDraft.nodes.filter((node) => node.kind === 'cf-call')
  assert.equal(calls[0].executor, 'codex')
  assert.equal(calls[0].onError, undefined)
  assert.equal(calls[1].executor, 'claude')
  assert.equal(result.cfDrafts.find((item) => item.cfId === candidate.cfId)?.revision, 3)
  assert.equal(
    result.cfDrafts.find((item) => item.cfId === candidate.cfId)?.output,
    'review result',
  )
})

test('revises an existing Flow into a branching graph with a terminal route', () => {
  const current: FlowDraft = {
    flowId: 'existing-flow',
    revision: 2,
    name: 'Existing',
    objective: 'preserve identity',
    workspaceRoot: process.cwd(),
    resources: [{ id: 'mail', type: 'folder', access: 'read', required: true }],
    nodes: [{ id: 'result-node', kind: 'output', outputId: 'final' }],
    edges: [],
  }
  const result = applyFlowRevision(
    current,
    [],
    [
      stage('读取邮件'),
      {
        kind: 'branch',
        name: '是否有新邮件',
        does: null,
        cfId: null,
        cond: 'hasNewMail',
        routes: [
          {
            caseId: 'none',
            condition: '没有新邮件，直接结束',
            endsFlow: true,
            stages: [],
          },
          {
            caseId: 'found',
            condition: '存在新邮件',
            endsFlow: false,
            stages: [stage('对比正文')],
          },
        ],
      },
      stage('输出结论'),
    ],
    { catalog: [], runtimeId: 'codex' },
  )

  assert.equal(result.flowDraft.flowId, current.flowId)
  assert.equal(result.flowDraft.workspaceRoot, current.workspaceRoot)
  assert.deepEqual(result.flowDraft.resources, current.resources)
  assert.ok(result.flowDraft.nodes.some((node) => node.kind === 'branch'))
  assert.ok(
    result.flowDraft.edges.some(
      (edge) =>
        edge.when?.outcome === 'branch-case' &&
        edge.when.caseId === 'none' &&
        edge.to === 'result-node',
    ),
  )
  const versions = result.cfDrafts.map((draft) => compileCF(draft))
  assert.doesNotThrow(() =>
    compileFlow(
      result.flowDraft,
      new Map(versions.map((version) => [`${version.cfId}@${version.version}`, version])),
    ),
  )
})

test('revision rejects control stages and cfIds outside this turn', () => {
  const current: FlowDraft = {
    flowId: 'existing-flow',
    revision: 1,
    name: 'Existing',
    objective: 'revise',
    workspaceRoot: process.cwd(),
    nodes: [{ id: 'output', kind: 'output', outputId: 'result' }],
    edges: [],
  }
  assert.throws(
    () => applyFlowRevision(current, [], [stage('x', { cfId: 'invented' })], { catalog: [] }),
    /RUNTIME_REVISION_CF_UNKNOWN/,
  )
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { compileCF, compileFlow } from './compiler.js'
import type { CFDraft, FlowDraft } from './types.js'

const cf: CFDraft = {
  cfId: 'echo',
  revision: 1,
  name: 'Echo',
  does: 'echo',
  inputContract: { type: 'object' },
  outputContract: { type: 'object' },
  defaultExecutor: 'echo',
}

test('compiles a CF to a deterministic single-capability program', () => {
  const first = compileCF(cf)
  const second = compileCF(JSON.parse(JSON.stringify(cf)) as CFDraft)
  assert.equal(first.version, '1.0.0')
  assert.equal(first.program.version, '0.2')
  assert.equal(first.programHash, second.programHash)
})

test('compiles the natural-language draft into one bounded agent task', () => {
  const generated = compileCF({
    cfId: 'generated',
    revision: 1,
    name: 'Generated',
    does: 'summarize the input',
    input: 'the raw report',
    output: 'a short summary',
  })
  assert.match(generated.program.task, /^summarize the input/)
  assert.match(generated.program.task, /Input guidance: the raw report/)
  assert.match(generated.program.task, /Output guidance: a short summary/)
  assert.equal((generated.draft.inputContract as any)?.type, 'object')
})

test('changing any guidance field changes the program hash', () => {
  const base = compileCF(cf)
  assert.notEqual(compileCF({ ...cf, does: 'echo twice' }).programHash, base.programHash)
  assert.notEqual(compileCF({ ...cf, process: 'be terse' }).programHash, base.programHash)
})

test('compiles ordered workspace file references into the agent task without file contents', () => {
  const referenced = compileCF({
    ...cf,
    does: 'update report.csv',
    effects: [{ type: 'file-read', scope: 'workspace', description: 'read workspace files' }],
    fileReferences: ['reports/report.csv', 'archive/report.csv'],
  })

  assert.match(referenced.program.task, /Indexed workspace files \(priority order\):/)
  assert.match(referenced.program.task, /1\. reports\/report\.csv/)
  assert.match(referenced.program.task, /2\. archive\/report\.csv/)
  assert.match(referenced.program.task, /first matching indexed path/)
  assert.match(referenced.program.task, /search the workspace/)
})

test('keeps inactive file references out of the compiled agent task', () => {
  const inactive = compileCF({
    ...cf,
    fileReferences: ['reports/private.txt'],
  })

  assert.doesNotMatch(inactive.program.task, /reports\/private\.txt/)
})

test('rejects an empty capability description', () => {
  assert.throws(() => compileCF({ ...cf, does: '   ' }), /CF_DOES_REQUIRED/)
})

test('rejects unsafe or duplicate workspace file references', () => {
  assert.throws(
    () => compileCF({ ...cf, fileReferences: ['../outside.txt'] }),
    /CF_FILE_PATH_INVALID/,
  )
  assert.throws(
    () => compileCF({ ...cf, fileReferences: ['notes/a.txt', 'notes/a.txt'] }),
    /CF_FILE_PATH_INVALID/,
  )
})

test('rejects invalid contracts and duplicate flow identifiers', () => {
  assert.throws(
    () => compileCF({ ...cf, inputContract: { type: 123 as never } }),
    /CF_INPUT_CONTRACT_INVALID/,
  )
  const version = compileCF(cf)
  const flow: FlowDraft = {
    flowId: 'duplicate-flow',
    revision: 1,
    name: 'Duplicate',
    objective: 'run',
    workspaceRoot: process.cwd(),
    nodes: [
      { id: 'call', kind: 'cf-call', cfRef: { cfId: 'echo', version: version.version } },
      { id: 'call', kind: 'output', outputId: 'result' },
    ],
    edges: [
      { id: 'entry', from: '$entry', to: 'call' },
      { id: 'finish', from: 'call', to: 'call' },
    ],
  }
  assert.throws(
    () => compileFlow(flow, new Map([[`echo@${version.version}`, version]])),
    /FLOW_DUPLICATE_NODE/,
  )
})

test('rejects removed node kinds and edge outcomes', () => {
  const removedNode = {
    flowId: 'removed-node',
    revision: 1,
    name: 'Removed node',
    objective: 'run',
    workspaceRoot: process.cwd(),
    nodes: [
      { id: 'approval', kind: 'approval', policyRef: 'manual' },
      { id: 'output', kind: 'output', outputId: 'result' },
    ],
    edges: [
      { id: 'start', from: '$entry', to: 'approval' },
      { id: 'end', from: 'approval', to: 'output' },
    ],
  } as unknown as FlowDraft
  assert.throws(() => compileFlow(removedNode, new Map()), /FLOW_NODE_KIND_INVALID:approval/)

  const removedOutcome = {
    flowId: 'removed-outcome',
    revision: 1,
    name: 'Removed outcome',
    objective: 'run',
    workspaceRoot: process.cwd(),
    nodes: [{ id: 'output', kind: 'output', outputId: 'result' }],
    edges: [
      {
        id: 'start',
        from: '$entry',
        to: 'output',
        when: { outcome: 'approved' },
      },
    ],
  } as unknown as FlowDraft
  assert.throws(() => compileFlow(removedOutcome, new Map()), /FLOW_EDGE_OUTCOME_INVALID:approved/)
})

test('compiles a sequential Flow into a hashed plan', () => {
  const version = compileCF(cf)
  const draft: FlowDraft = {
    flowId: 'flow',
    revision: 1,
    name: 'Flow',
    objective: 'run',
    workspaceRoot: process.cwd(),
    nodes: [
      {
        id: 'call',
        kind: 'cf-call',
        cfRef: { cfId: 'echo', version: version.version },
        inputDefaults: { message: 'hi' },
      },
      { id: 'output', kind: 'output', outputId: 'result' },
    ],
    edges: [
      { id: 'start', from: '$entry', to: 'call' },
      { id: 'end', from: 'call', to: 'output' },
    ],
  }
  const plan = compileFlow(draft, new Map([[`echo@${version.version}`, version]]))
  assert.equal(plan.entries[0], 0)
  assert.equal(plan.edges[1].from, 0)
  assert.equal(plan.nodes[0].programHash, version.programHash)
  assert.equal(plan.workspaceRoot, process.cwd())
  assert.notEqual(
    compileFlow(
      { ...draft, workspaceRoot: '/tmp' },
      new Map([[`echo@${version.version}`, version]]),
    ).planHash,
    plan.planHash,
  )
})

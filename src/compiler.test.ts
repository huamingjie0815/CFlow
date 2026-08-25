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
  program: {
    version: '0.1',
    cfId: 'echo',
    sourceRevision: 1,
    entry: 10,
    steps: [
      { index: 10, kind: 'agent', task: 'echo', input: '$input', next: 20 },
      { index: 20, kind: 'return', source: '$local.10.output' },
    ],
    limits: { maxStepExecutions: 4, maxExternalCalls: 1, maxOutputBytes: 4096 },
  },
}

test('compiles CF with stable non-array step indexes and deterministic hash', () => {
  const first = compileCF(cf)
  const second = compileCF(JSON.parse(JSON.stringify(cf)) as CFDraft)
  assert.equal(first.version, '1.0.0')
  assert.equal(first.programHash, second.programHash)
})

test('creates a runnable minimal program from a natural-language CF draft', () => {
  const generated = compileCF({
    cfId: 'generated',
    revision: 1,
    name: 'Generated',
    does: 'summarize the input',
  })
  assert.equal(generated.program.steps[0].kind, 'agent')
  assert.equal((generated.program.steps[0] as any).task, 'summarize the input')
  assert.equal((generated.draft.inputContract as any)?.type, 'object')
})

test('rejects CF cycles and missing returns', () => {
  const cycle = structuredClone(cf)
  cycle.program!.steps = [{ index: 10, kind: 'agent', task: 'loop', next: 10 }]
  assert.throws(() => compileCF(cycle), /CF_NO_RETURN/)
  const missing = structuredClone(cf)
  missing.program!.steps[0] = { index: 10, kind: 'agent', task: 'bad', next: 999 }
  assert.throws(() => compileCF(missing), /CF_BAD_NEXT/)
})

test('rejects invalid contracts, limits, and duplicate flow identifiers', () => {
  assert.throws(
    () => compileCF({ ...cf, inputContract: { type: 123 as never } }),
    /CF_INPUT_CONTRACT_INVALID/,
  )
  assert.throws(
    () =>
      compileCF({
        ...cf,
        program: { ...cf.program!, limits: { ...cf.program!.limits, maxOutputBytes: 0 } },
      }),
    /CF_INVALID_OUTPUT_LIMIT/,
  )
  const version = compileCF(cf)
  const flow: FlowDraft = {
    flowId: 'duplicate-flow',
    revision: 1,
    name: 'Duplicate',
    objective: 'run',
    nodes: [
      { id: 'call', kind: 'cf-call', cfRef: { cfId: 'echo', version: version.version } },
      { id: 'output', kind: 'output', outputId: 'result' },
    ],
    edges: [
      { id: 'entry', from: '$entry', to: 'call' },
      { id: 'finish', from: 'call', to: 'output' },
    ],
    bindings: [
      { id: 'value', from: 'call.output', to: 'output.input' },
      { id: 'value', from: 'call.output', to: 'output.other' },
    ],
  }
  assert.throws(
    () => compileFlow(flow, new Map([[`echo@${version.version}`, version]])),
    /FLOW_DUPLICATE_BINDING/,
  )
})

test('compiles Flow bindings and rejects unknown references', () => {
  const version = compileCF(cf)
  const draft: FlowDraft = {
    flowId: 'flow',
    revision: 1,
    name: 'Flow',
    objective: 'run',
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
    bindings: [{ id: 'value', from: 'call.output', to: 'output.input' }],
  }
  const plan = compileFlow(draft, new Map([[`echo@${version.version}`, version]]))
  assert.equal(plan.entries[0], 0)
  assert.equal(plan.edges[1].from, 0)
  assert.throws(
    () =>
      compileFlow(
        { ...draft, bindings: [{ id: 'bad', from: 'missing.output', to: 'output.input' }] },
        new Map([[`echo@${version.version}`, version]]),
      ),
    /BAD_BINDING_SOURCE/,
  )
  assert.throws(
    () =>
      compileFlow(
        { ...draft, bindings: [{ id: 'backward', from: 'output.output', to: 'call.input' }] },
        new Map([[`echo@${version.version}`, version]]),
      ),
    /BINDING_CONTROL_UNREACHABLE/,
  )
})

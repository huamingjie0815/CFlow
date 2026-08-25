import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Store } from './db.js'
import { compileCF, compileFlow } from './compiler.js'
import { builtins, Engine } from './engine.js'
import type { CFDraft, FlowDraft } from './types.js'

test('runs a published Flow, validates contracts and records Ledger', async () => {
  const cf: CFDraft = {
    cfId: 'echo-runtime',
    revision: 1,
    name: 'Echo',
    does: 'echo',
    inputContract: { type: 'object' },
    outputContract: { type: 'object' },
    defaultExecutor: 'echo',
    program: {
      version: '0.1',
      cfId: 'echo-runtime',
      sourceRevision: 1,
      entry: 0,
      steps: [
        { index: 0, kind: 'agent', task: 'echo', input: '$input', next: 1 },
        { index: 1, kind: 'return', source: '$local.0.output' },
      ],
      limits: { maxStepExecutions: 4, maxExternalCalls: 1, maxOutputBytes: 4096 },
    },
  }
  const version = compileCF(cf)
  const flow: FlowDraft = {
    flowId: 'runtime-flow',
    revision: 1,
    name: 'Runtime',
    objective: 'echo',
    nodes: [
      { id: 'call', kind: 'cf-call', cfRef: { cfId: cf.cfId, version: version.version } },
      { id: 'out', kind: 'output', outputId: 'result' },
    ],
    edges: [
      { id: 'entry', from: '$entry', to: 'call' },
      { id: 'finish', from: 'call', to: 'out' },
    ],
    bindings: [
      { id: 'input', from: '$user.input.message', to: 'call.input.message' },
      { id: 'output', from: 'call.output', to: 'out.input' },
    ],
  }
  const plan = compileFlow(flow, new Map([[`${cf.cfId}@${version.version}`, version]]))
  const store = new Store(`/tmp/cf-engine-${randomUUID()}.sqlite`)
  const runId = randomUUID()
  store.createRun(runId, `${plan.flowId}@${plan.flowVersion}`, { message: 'hello' })
  const engine = new Engine(store, builtins(), () => [version])
  engine.start(runId, plan)
  for (let i = 0; i < 100; i++) {
    const run = store.getRun(runId)
    if (run?.status === 'completed' || run?.status === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const run = store.getRun(runId)
  assert.equal(run?.status, 'completed')
  assert.equal((run?.value as any).value.input.input.message, 'hello')
  assert.ok(store.events(runId).some((event) => event.type === 'run.completed'))
  store.close()
})

test('evaluates a restricted branch and marks the inactive path', async () => {
  const flow: FlowDraft = {
    flowId: 'branch-flow',
    revision: 1,
    name: 'Branch',
    objective: 'route',
    nodes: [
      { id: 'route', kind: 'branch', cond: { $get: 'risk' }, cases: ['high', 'normal'] },
      { id: 'high', kind: 'output', outputId: 'high' },
      { id: 'normal', kind: 'output', outputId: 'normal' },
    ],
    edges: [
      { id: 'entry', from: '$entry', to: 'route' },
      { id: 'high', from: 'route', to: 'high', when: { outcome: 'branch-case', caseId: 'high' } },
      {
        id: 'normal',
        from: 'route',
        to: 'normal',
        when: { outcome: 'branch-case', caseId: 'normal' },
      },
    ],
    bindings: [{ id: 'risk', from: '$user.input.risk', to: 'route.input.risk' }],
  }
  const plan = compileFlow(flow, new Map())
  const store = new Store(`/tmp/cf-branch-${randomUUID()}.sqlite`)
  const runId = randomUUID()
  store.createRun(runId, `${plan.flowId}@${plan.flowVersion}`, { risk: 'high' })
  new Engine(store, builtins(), () => []).start(runId, plan)
  for (let i = 0; i < 100; i++) {
    const run = store.getRun(runId)
    if (run?.status === 'completed' || run?.status === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const run = store.getRun(runId)
  assert.equal(run?.status, 'completed')
  assert.equal((run?.value as any).outputId, 'high')
  assert.ok(store.events(runId).some((event) => event.type === 'node.inactive' && event.node === 2))
  store.close()
})

test('allows a shared downstream node after an exclusive branch', async () => {
  const flow: FlowDraft = {
    flowId: 'shared-branch',
    revision: 1,
    name: 'Shared',
    objective: 'route',
    nodes: [
      { id: 'route', kind: 'branch', cond: { $get: 'risk' }, cases: ['high', 'normal'] },
      { id: 'out', kind: 'output', outputId: 'result' },
    ],
    edges: [
      { id: 'entry', from: '$entry', to: 'route' },
      { id: 'high', from: 'route', to: 'out', when: { outcome: 'branch-case', caseId: 'high' } },
      {
        id: 'normal',
        from: 'route',
        to: 'out',
        when: { outcome: 'branch-case', caseId: 'normal' },
      },
    ],
    bindings: [{ id: 'risk', from: '$user.input.risk', to: 'route.input.risk' }],
  }
  const plan = compileFlow(flow, new Map())
  const store = new Store(`/tmp/cf-shared-${randomUUID()}.sqlite`)
  const runId = randomUUID()
  store.createRun(runId, `${plan.flowId}@${plan.flowVersion}`, { risk: 'normal' })
  new Engine(store, builtins(), () => []).start(runId, plan)
  for (let i = 0; i < 100; i++) {
    const run = store.getRun(runId)
    if (run?.status === 'completed' || run?.status === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(store.getRun(runId)?.status, 'completed')
  store.close()
})

test('cancels an in-flight run and records cancellation', async () => {
  const cf: CFDraft = {
    cfId: 'slow',
    revision: 1,
    name: 'Slow',
    does: 'slow',
    inputContract: { type: 'object' },
    outputContract: { type: 'object' },
    defaultExecutor: 'slow-executor',
    program: {
      version: '0.1',
      cfId: 'slow',
      sourceRevision: 1,
      entry: 0,
      steps: [
        { index: 0, kind: 'agent', task: 'slow', next: 1 },
        { index: 1, kind: 'return' },
      ],
      limits: { maxStepExecutions: 4, maxExternalCalls: 1, maxOutputBytes: 4096 },
    },
  }
  const version = compileCF(cf)
  const flow: FlowDraft = {
    flowId: 'slow-flow',
    revision: 1,
    name: 'Slow',
    objective: 'cancel',
    nodes: [
      { id: 'call', kind: 'cf-call', cfRef: { cfId: cf.cfId, version: version.version } },
      { id: 'out', kind: 'output', outputId: 'result' },
    ],
    edges: [
      { id: 'start', from: '$entry', to: 'call' },
      { id: 'finish', from: 'call', to: 'out' },
    ],
    bindings: [{ id: 'output', from: 'call.output', to: 'out.input' }],
  }
  const plan = compileFlow(flow, new Map([[`${cf.cfId}@${version.version}`, version]]))
  const store = new Store(`/tmp/cf-cancel-${randomUUID()}.sqlite`)
  const registry = builtins().register({
    id: 'slow-executor',
    execute: (_task, _input, signal) =>
      new Promise((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('unexpected timeout')), 1000)
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            reject(new Error('aborted'))
          },
          { once: true },
        )
      }),
  })
  const runId = randomUUID()
  store.createRun(runId, `${plan.flowId}@${plan.flowVersion}`)
  const engine = new Engine(store, registry, () => [version])
  engine.start(runId, plan)
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(engine.cancel(runId), true)
  for (let i = 0; i < 100; i++) {
    const run = store.getRun(runId)
    if (run?.status === 'cancelled' || run?.status === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(store.getRun(runId)?.status, 'cancelled')
  store.close()
})

test('retries a failed CF call only within its declared bound', async () => {
  const cf: CFDraft = {
    cfId: 'flaky',
    revision: 1,
    name: 'Flaky',
    does: 'flaky',
    inputContract: { type: 'object' },
    outputContract: { type: 'object' },
    defaultExecutor: 'flaky-executor',
    program: {
      version: '0.1',
      cfId: 'flaky',
      sourceRevision: 1,
      entry: 0,
      steps: [
        { index: 0, kind: 'agent', task: 'flaky', next: 1 },
        { index: 1, kind: 'return', source: '$local.0.output' },
      ],
      limits: { maxStepExecutions: 4, maxExternalCalls: 1, maxOutputBytes: 4096 },
    },
  }
  const version = compileCF(cf)
  const flow: FlowDraft = {
    flowId: 'flaky-flow',
    revision: 1,
    name: 'Flaky',
    objective: 'retry',
    nodes: [
      {
        id: 'call',
        kind: 'cf-call',
        cfRef: { cfId: cf.cfId, version: version.version },
        onError: { action: 'retry', maxAttempts: 2 },
      },
      { id: 'out', kind: 'output', outputId: 'result' },
    ],
    edges: [
      { id: 'start', from: '$entry', to: 'call' },
      { id: 'finish', from: 'call', to: 'out' },
    ],
    bindings: [{ id: 'output', from: 'call.output', to: 'out.input' }],
  }
  const plan = compileFlow(flow, new Map([[`${cf.cfId}@${version.version}`, version]]))
  const store = new Store(`/tmp/cf-retry-${randomUUID()}.sqlite`)
  let calls = 0
  const registry = builtins().register({
    id: 'flaky-executor',
    execute: async (_task, input) => {
      calls++
      if (calls === 1) throw new Error('transient')
      return input
    },
  })
  const runId = randomUUID()
  store.createRun(runId, `${plan.flowId}@${plan.flowVersion}`)
  new Engine(store, registry, () => [version]).start(runId, plan)
  for (let i = 0; i < 100; i++) {
    const run = store.getRun(runId)
    if (run?.status === 'completed' || run?.status === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(store.getRun(runId)?.status, 'completed')
  assert.equal(calls, 2)
  assert.ok(store.events(runId).some((event) => event.type === 'node.retry'))
  store.close()
})

test('pauses for approval and resumes on an explicit decision', async () => {
  const flow: FlowDraft = {
    flowId: 'approval-flow',
    revision: 1,
    name: 'Approval',
    objective: 'approve',
    nodes: [
      { id: 'review', kind: 'approval', policyRef: 'manual-review' },
      { id: 'approved', kind: 'output', outputId: 'approved' },
      { id: 'rejected', kind: 'output', outputId: 'rejected' },
    ],
    edges: [
      { id: 'entry', from: '$entry', to: 'review' },
      { id: 'yes', from: 'review', to: 'approved', when: { outcome: 'approved' } },
      { id: 'no', from: 'review', to: 'rejected', when: { outcome: 'rejected' } },
    ],
    bindings: [],
  }
  const plan = compileFlow(flow, new Map())
  const store = new Store(`/tmp/cf-approval-${randomUUID()}.sqlite`)
  const runId = randomUUID()
  store.createRun(runId, `${plan.flowId}@${plan.flowVersion}`)
  const engine = new Engine(store, builtins(), () => [])
  engine.start(runId, plan)
  for (let i = 0; i < 100; i++) {
    if (store.getRun(runId)?.status === 'waiting-approval') break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(store.getRun(runId)?.status, 'waiting-approval')
  await new Promise((resolve) => setTimeout(resolve, 20))
  store.decideApproval(runId, 0, 'approved')
  engine.start(runId, plan)
  for (let i = 0; i < 100; i++) {
    const run = store.getRun(runId)
    if (run?.status === 'completed' || run?.status === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(store.getRun(runId)?.status, 'completed')
  assert.equal((store.getRun(runId)?.value as any).outputId, 'approved')
  store.close()
})

test('fails closed on contract and plan integrity violations', async () => {
  const cf: CFDraft = {
    cfId: 'integrity',
    revision: 1,
    name: 'Integrity',
    does: 'bad',
    inputContract: { type: 'object' },
    outputContract: { type: 'object' },
    defaultExecutor: 'bad-output',
    program: {
      version: '0.1',
      cfId: 'integrity',
      sourceRevision: 1,
      entry: 0,
      steps: [
        { index: 0, kind: 'agent', task: 'bad', next: 1 },
        { index: 1, kind: 'return', source: '$local.0.output' },
      ],
      limits: { maxStepExecutions: 4, maxExternalCalls: 1, maxOutputBytes: 4096 },
    },
  }
  const version = compileCF(cf)
  const flow: FlowDraft = {
    flowId: 'integrity-flow',
    revision: 1,
    name: 'Integrity',
    objective: 'fail',
    nodes: [
      { id: 'call', kind: 'cf-call', cfRef: { cfId: cf.cfId, version: version.version } },
      { id: 'out', kind: 'output', outputId: 'result' },
    ],
    edges: [
      { id: 'start', from: '$entry', to: 'call' },
      { id: 'finish', from: 'call', to: 'out' },
    ],
    bindings: [{ id: 'output', from: 'call.output', to: 'out.input' }],
  }
  const plan = compileFlow(flow, new Map([[`${cf.cfId}@${version.version}`, version]]))
  const store = new Store(`/tmp/cf-integrity-${randomUUID()}.sqlite`)
  const registry = builtins().register({ id: 'bad-output', execute: async () => 'not-an-object' })
  const runId = randomUUID()
  store.createRun(runId, `${plan.flowId}@${plan.flowVersion}`)
  new Engine(store, registry, () => [version]).start(runId, plan)
  for (let i = 0; i < 100; i++) {
    if (['completed', 'failed'].includes(store.getRun(runId)?.status ?? '')) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(store.getRun(runId)?.status, 'failed')
  store.close()
  const tampered = { ...plan, objective: 'changed' }
  const store2 = new Store(`/tmp/cf-tampered-${randomUUID()}.sqlite`)
  const id2 = randomUUID()
  store2.createRun(id2, `${plan.flowId}@${plan.flowVersion}`)
  new Engine(store2, builtins(), () => [version]).start(id2, tampered)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(store2.getRun(id2)?.status, 'failed')
  store2.close()
})

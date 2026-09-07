import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRunLog, describeLedgerEvent, eventTone } from '../web/src/run-log.js'
import { deriveNodeRunStates } from '../web/src/run.js'
import type { FlowDraft, LedgerEvent, RunDetail } from '../web/src/types.js'

const draft: FlowDraft = {
  flowId: 'f',
  revision: 1,
  name: '报销核对',
  objective: 'run',
  workspaceRoot: '/tmp/ws',
  nodes: [
    { id: 'step-1', kind: 'cf-call', name: '读取报销单', cfRef: { cfId: 'c1', version: '1.0.0' } },
    { id: 'step-2', kind: 'cf-call', name: '核对发票', cfRef: { cfId: 'c2', version: '1.0.0' } },
    { id: 'out', kind: 'output', outputId: 'result' },
  ],
  edges: [],
}

let seq = 0
const ev = (type: string, node?: number, data?: unknown): LedgerEvent =>
  ({
    seq: ++seq,
    runId: 'r',
    type,
    node,
    data,
    at: `2026-08-31T10:00:${String(seq).padStart(2, '0')}Z`,
  }) as LedgerEvent

const runOf = (events: LedgerEvent[], status = 'completed'): RunDetail =>
  ({ run: { id: 'r', status }, events }) as unknown as RunDetail

test('groups by step in dispatch order, not declaration order', () => {
  seq = 0
  // step-2 (index 1) dispatches before step-1 (index 0).
  const log = buildRunLog(
    draft,
    runOf([
      ev('run.started'),
      ev('node.started', 1),
      ev('node.started', 0),
      ev('node.completed', 1, { value: { ok: true } }),
      ev('node.completed', 0, { value: null }),
      ev('run.completed', undefined, { outputId: 'result' }),
    ]),
  )
  assert.ok(log)
  assert.deepEqual(
    log!.nodes.map((g) => g.nodeId),
    ['step-2', 'step-1'],
  )
  assert.deepEqual(
    log!.nodes.map((g) => g.order),
    [1, 2],
  )
  assert.equal(log!.nodes[0].title, '核对发票')
})

test('run-level events stay in the run group, never in a step group', () => {
  seq = 0
  const log = buildRunLog(
    draft,
    runOf([
      ev('run.started'),
      ev('resources.bound', undefined, { profileId: 'p', resources: [{ requirementId: 'a' }] }),
      ev('node.started', 0),
      ev('run.completed', undefined, { outputId: 'result' }),
    ]),
  )
  assert.deepEqual(
    log!.run.entries.map((e) => e.type),
    ['run.started', 'resources.bound', 'run.completed'],
  )
  assert.equal(log!.nodes.length, 1)
  assert.deepEqual(
    log!.nodes[0].entries.map((e) => e.type),
    ['node.started'],
  )
})

test('an out-of-range step index is marked stale instead of borrowing a name', () => {
  seq = 0
  const log = buildRunLog(draft, runOf([ev('node.started', 9), ev('node.completed', 9)]))
  const group = log!.nodes[0]
  assert.equal(group.stale, true)
  assert.equal(group.nodeId, undefined)
  assert.match(group.title, /第 10 步/)
  // It must not claim to be one of the current steps.
  assert.doesNotMatch(group.title, /读取报销单|核对发票/)
})

test('per-step state agrees with the canvas node states', () => {
  seq = 0
  const events = [
    ev('run.started'),
    ev('node.started', 0),
    ev('node.completed', 0),
    ev('node.started', 1),
    ev('node.retry', 1, { attempt: 2 }),
    ev('node.failed', 1, { error: 'BOOM' }),
    ev('node.inactive', 2),
  ]
  const run = runOf(events, 'failed')
  const log = buildRunLog(draft, run)
  const canvas = deriveNodeRunStates(draft, run)
  for (const group of log!.nodes) {
    assert.equal(group.state, canvas.get(group.nodeId!), `state mismatch for ${group.nodeId}`)
  }
  assert.equal(canvas.get('step-2'), 'failed')
})

test('no event type produces a raw identifier as its title', () => {
  const everyType = [
    'run.started',
    'run.completed',
    'run.failed',
    'run.cancelled',
    'run.needs-reconciliation',
    'resources.bound',
    'resource.access',
    'node.started',
    'node.completed',
    'node.failed',
    'node.inactive',
    'node.blocked',
    'node.retry',
    'some.future.event',
  ]
  for (const type of everyType) {
    seq = 0
    const { title, detail } = describeLedgerEvent(ev(type, 0), '核对发票')
    assert.doesNotMatch(title, /^[a-z]+[.a-z-]*$/, `raw type leaked into title for ${type}`)
    assert.ok(title.length > 0, `empty title for ${type}`)
    assert.ok(detail.length > 0, `empty detail for ${type}`)
  }
})

test('failure codes read as what to do, not as codes', () => {
  seq = 0
  for (const [code, expect] of [
    ['PLAN_HASH_MISMATCH', /重新检查并测试/],
    ['RESOURCE_BINDING_MISSING', /设置里补全/],
    ['STEP_LIMIT_EXCEEDED', /绕圈/],
    ['NO_TERMINAL_OUTPUT', /流程结果/],
    ['FLOW_STALLED', /连线和分支条件/],
  ] as const) {
    const described = describeLedgerEvent(ev('run.failed', undefined, { code }))
    assert.match(described.detail, expect, `bad copy for ${code}`)
    assert.doesNotMatch(described.title, /[A-Z_]{4,}/)
  }
})

test('an upstream failure explains that the step was skipped', () => {
  seq = 0
  const described = describeLedgerEvent(
    ev('node.failed', 1, { error: 'UPSTREAM_FAILURE' }),
    '核对发票',
  )
  assert.match(described.detail, /上一步失败了/)
  assert.doesNotMatch(described.detail, /UPSTREAM_FAILURE/)
})

test('both reconciliation shapes are covered', () => {
  seq = 0
  const runLevel = describeLedgerEvent(ev('run.needs-reconciliation', undefined, { nodes: [1, 2] }))
  assert.match(runLevel.detail, /2 个步骤/)
  const nodeLevel = describeLedgerEvent(
    ev('run.needs-reconciliation', 1, { error: { code: 'X' } }),
    '核对发票',
  )
  assert.match(nodeLevel.title, /核对发票/)
  assert.match(nodeLevel.detail, /人工核对/)
})

test('raw payloads are confined to the technical field', () => {
  seq = 0
  const described = describeLedgerEvent(
    ev('node.completed', 0, { value: { secret: 'abc' } }),
    '读取报销单',
  )
  assert.doesNotMatch(described.detail, /secret/)
  assert.match(described.technical ?? '', /secret/)
})

test('tones cover success, failure and skipped', () => {
  seq = 0
  assert.equal(eventTone(ev('node.completed', 0)), 'completed')
  assert.equal(eventTone(ev('node.failed', 0)), 'failed')
  assert.equal(eventTone(ev('run.needs-reconciliation')), 'failed')
  assert.equal(eventTone(ev('node.inactive', 0)), 'disabled')
  assert.equal(eventTone(ev('node.started', 0)), 'running')
})

test('returns null without a draft or a run', () => {
  assert.equal(buildRunLog(null, runOf([])), null)
  assert.equal(buildRunLog(draft, null), null)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFlowList, currentFlowLabel, filterFlowList } from '../web/src/flow-list.js'
import type { FlowDraft, FlowPlan } from '../web/src/types.js'

const draft = (flowId: string, name: string, revision = 1, nodes = 3): FlowDraft =>
  ({
    flowId,
    revision,
    name,
    objective: `${name} 的目标`,
    workspaceRoot: '/tmp/ws',
    nodes: Array.from({ length: nodes }, (_, i) => ({
      id: `n${i}`,
      kind: 'output',
      outputId: 'r',
    })),
    edges: [],
  }) as unknown as FlowDraft

const plan = (flowId: string, objective: string, flowVersion: string, nodes = 4): FlowPlan =>
  ({
    flowId,
    flowVersion,
    objective,
    nodes: Array.from({ length: nodes }, (_, i) => ({ id: `n${i}`, index: i })),
    edges: [],
  }) as unknown as FlowPlan

test('one row per draft and per published version', () => {
  const rows = buildFlowList(
    [draft('a', '报销核对', 3, 7)],
    [plan('b', '入职资料', '1.0.0'), plan('b', '入职资料', '2.0.0')],
  )
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map((r) => r.key).sort(), ['a', 'b@1.0.0', 'b@2.0.0'])
})

test('status labels and details read in business language', () => {
  const rows = buildFlowList([draft('a', '报销核对', 3, 7)], [plan('b', '入职资料', '2.0.0', 5)])
  const draftRow = rows.find((r) => r.key === 'a')!
  assert.equal(draftRow.statusLabel, '草稿')
  assert.equal(draftRow.statusTone, 'draft')
  assert.equal(draftRow.detail, '第 3 稿 · 7 个步骤')
  const planRow = rows.find((r) => r.key === 'b@2.0.0')!
  assert.equal(planRow.statusLabel, 'v2.0.0 已发布')
  assert.equal(planRow.statusTone, 'published')
  assert.equal(planRow.detail, '5 个步骤')
})

test('the current flow floats to the top', () => {
  const rows = buildFlowList([draft('z-flow', '最后一个'), draft('a-flow', '第一个')], [], 'z-flow')
  assert.equal(rows[0].flowId, 'z-flow')
})

test('rows of one flow stay adjacent, draft before its versions', () => {
  const rows = buildFlowList([draft('b', '入职资料')], [plan('b', '入职资料', '1.0.0')])
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['draft', 'published'],
  )
})

test('an unnamed draft still gets a readable name', () => {
  const bare = { ...draft('a', ''), name: '', objective: '' } as FlowDraft
  assert.equal(buildFlowList([bare], [])[0].name, '未命名流程')
})

test('search matches name, objective and flow id', () => {
  const rows = buildFlowList(
    [draft('reimburse-1', '报销核对')],
    [plan('onboard', '入职资料', '1.0.0')],
  )
  assert.equal(filterFlowList(rows, '报销').length, 1)
  assert.equal(filterFlowList(rows, '的目标').length, 1)
  assert.equal(filterFlowList(rows, 'onboard').length, 1)
  assert.equal(filterFlowList(rows, '  ').length, 2)
  assert.equal(filterFlowList(rows, '不存在').length, 0)
})

test('the trigger label reflects the selected flow', () => {
  const rows = buildFlowList([draft('a', '报销核对', 2)], [plan('b', '入职资料', '1.0.0')])
  assert.deepEqual(currentFlowLabel(rows, null), {
    name: '还没有流程',
    statusLabel: '',
    statusTone: 'none',
  })
  assert.equal(currentFlowLabel(rows, 'a').name, '报销核对')
  assert.equal(currentFlowLabel(rows, 'a').statusLabel, '草稿')
  assert.equal(currentFlowLabel(rows, 'b').statusLabel, 'v1.0.0 已发布')
  // A brand-new local draft not yet in the list must not render as empty.
  assert.equal(currentFlowLabel(rows, 'unsaved').name, '未命名流程')
})

test('empty inputs are safe', () => {
  assert.deepEqual(buildFlowList([], []), [])
  assert.deepEqual(filterFlowList([], 'x'), [])
})

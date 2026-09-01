import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canApplyAgentRevision,
  draftSaveStatus,
  flowTestCounts,
  nextSignalAction,
  reconcileCanvasNodes,
  runStopControl,
  snapshotFileList,
} from '../web/src/workbench-ui.js'

const ladder = {
  hasDraft: true,
  workspaceAvailable: true,
  isRunning: false,
  hasPreview: false,
  testState: 'idle' as const,
  hasPublishedPlan: false,
}

test('exactly one action is ever signalled, and it is the next real step', () => {
  // No flow yet: the goal composer owns the only filled control.
  assert.equal(nextSignalAction({ ...ladder, hasDraft: false }), 'goal')
  // Draft with no check yet -> 检查 is genuinely next.
  assert.equal(nextSignalAction(ladder), 'check')
  // Checked but not tested -> 测试.
  assert.equal(nextSignalAction({ ...ladder, hasPreview: true }), 'test')
  // Tested -> 发布.
  assert.equal(nextSignalAction({ ...ladder, hasPreview: true, testState: 'passed' }), 'publish')
  // Published -> 运行, but only once a published plan actually exists.
  assert.equal(
    nextSignalAction({
      ...ladder,
      hasPreview: true,
      testState: 'published',
      hasPublishedPlan: true,
    }),
    'run',
  )
  assert.equal(nextSignalAction({ ...ladder, hasPreview: true, testState: 'published' }), null)
})

test('nothing is signalled while a run is in flight or the workspace is gone', () => {
  assert.equal(nextSignalAction({ ...ladder, hasPreview: true, isRunning: true }), null)
  assert.equal(nextSignalAction({ ...ladder, hasPreview: true, workspaceAvailable: false }), null)
})

test('a failed test still points back at 测试', () => {
  assert.equal(nextSignalAction({ ...ladder, hasPreview: true, testState: 'failed' }), 'test')
  assert.equal(nextSignalAction({ ...ladder, hasPreview: true, testState: 'cancelled' }), 'test')
})

test('offers a stop action for both test and published runs', () => {
  assert.deepEqual(runStopControl('test', 'test-run'), {
    label: '停止测试',
    disabled: false,
  })
  assert.deepEqual(runStopControl('live', 'live-run'), {
    label: '停止运行',
    disabled: false,
  })
  assert.deepEqual(runStopControl('test', null), {
    label: '正在启动测试',
    disabled: true,
  })
  assert.equal(runStopControl(null, null), null)
})

test('hides the draft save status after autosave succeeds', () => {
  assert.equal(draftSaveStatus({ isPending: false, isError: false, dirty: false }), null)
  assert.equal(draftSaveStatus({ isPending: false, isError: true, dirty: false }), null)
  assert.equal(draftSaveStatus({ isPending: true, isError: false, dirty: true }), '保存中')
  assert.equal(draftSaveStatus({ isPending: false, isError: true, dirty: true }), '保存失败')
})

test('snapshots selected files before the browser input is cleared', () => {
  const selected = { name: 'SKILL.md' }
  const liveFileList: ArrayLike<typeof selected> = { 0: selected, length: 1 }

  const snapshot = snapshotFileList(liveFileList)
  liveFileList.length = 0

  assert.deepEqual(snapshot, [selected])
})

test('counts persisted test attempts per flow and ignores previews', () => {
  assert.deepEqual(
    flowTestCounts([
      { flowId: 'flow-a', mode: 'preview' },
      { flowId: 'flow-a', mode: 'test' },
      { flowId: 'flow-a', mode: 'test' },
      { flowId: 'flow-b', mode: 'test' },
    ]),
    { 'flow-a': 2, 'flow-b': 1 },
  )
})

test('refreshes canvas content without dropping measured node state', () => {
  const current = [
    {
      id: 'step-1',
      position: { x: 240, y: 160 },
      measured: { width: 220, height: 120 },
      data: { label: '旧名称' },
    },
  ]
  const incoming = [
    { id: 'step-1', position: { x: 180, y: 150 }, data: { label: '新名称' } },
    { id: 'step-2', position: { x: 450, y: 150 }, data: { label: '新节点' } },
  ]

  assert.deepEqual(reconcileCanvasNodes(current, incoming), [
    {
      id: 'step-1',
      position: { x: 240, y: 160 },
      measured: { width: 220, height: 120 },
      data: { label: '新名称' },
    },
    incoming[1],
  ])
})

test('agent revisions only apply to the exact flow revision that was sent', () => {
  const sent = { flowId: 'flow-a', revision: 4 }
  assert.equal(canApplyAgentRevision(sent, { flowId: 'flow-a', revision: 4 }), true)
  assert.equal(canApplyAgentRevision(sent, { flowId: 'flow-a', revision: 5 }), false)
  assert.equal(canApplyAgentRevision(sent, { flowId: 'flow-b', revision: 4 }), false)
  assert.equal(canApplyAgentRevision(sent, null), false)
})

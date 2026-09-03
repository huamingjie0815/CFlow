import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_PANEL_DEFAULT_WIDTH,
  applyCurrentRuntime,
  canApplyAgentRevision,
  arrangeCanvasPositions,
  clampPanelWidth,
  constrainPanelWidths,
  DETAIL_PANEL_DEFAULT_WIDTH,
  draftSaveStatus,
  flowTestCounts,
  nextSignalAction,
  reconcileCanvasNodes,
  runStopControl,
  snapshotFileList,
} from '../web/src/workbench-ui.js'

test('retrying an assistant turn uses the session current Agent', () => {
  const failedSnapshot = { runtimeId: 'codex', revision: 7 }
  const retrySnapshot = applyCurrentRuntime(failedSnapshot, 'claude-code')

  assert.deepEqual(retrySnapshot, { runtimeId: 'claude-code', revision: 7 })
  assert.deepEqual(failedSnapshot, { runtimeId: 'codex', revision: 7 })
})

test('side panel resizing preserves the canvas and clamps extreme widths', () => {
  assert.equal(clampPanelWidth(120, 1280, AGENT_PANEL_DEFAULT_WIDTH), 240)
  assert.equal(clampPanelWidth(900, 1280, AGENT_PANEL_DEFAULT_WIDTH), 380)
  assert.equal(clampPanelWidth(460, 1600, AGENT_PANEL_DEFAULT_WIDTH), 460)
  assert.deepEqual(constrainPanelWidths({ left: 520, right: 520 }, 1280), { left: 360, right: 360 })
  assert.deepEqual(
    constrainPanelWidths(
      { left: DETAIL_PANEL_DEFAULT_WIDTH, right: AGENT_PANEL_DEFAULT_WIDTH },
      1280,
    ),
    { left: DETAIL_PANEL_DEFAULT_WIDTH, right: AGENT_PANEL_DEFAULT_WIDTH },
  )
})

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

test('arranges branch successors on one level without overlap', () => {
  const positions = arrangeCanvasPositions(
    ['prepare', 'branch-1', 'approve', 'reject', 'output-1'],
    [
      { id: 'entry-prepare', from: '$entry', to: 'prepare' },
      { id: 'prepare-branch', from: 'prepare', to: 'branch-1' },
      { id: 'branch-approve', from: 'branch-1', to: 'approve' },
      { id: 'branch-reject', from: 'branch-1', to: 'reject' },
      { id: 'approve-output', from: 'approve', to: 'output-1' },
      { id: 'reject-output', from: 'reject', to: 'output-1' },
    ],
  )

  assert.equal(positions.$entry.y < positions.prepare.y, true)
  assert.equal(positions.prepare.y < positions['branch-1'].y, true)
  assert.equal(positions.approve.y, positions.reject.y)
  assert.notEqual(positions.approve.x, positions.reject.x)
  assert.equal(positions.approve.x < positions.reject.x, true)
  assert.equal(positions['branch-1'].y < positions.approve.y, true)
  assert.equal(positions.approve.y < positions['output-1'].y, true)
})

test('agent revisions only apply to the exact flow revision that was sent', () => {
  const sent = { flowId: 'flow-a', revision: 4 }
  assert.equal(canApplyAgentRevision(sent, { flowId: 'flow-a', revision: 4 }), true)
  assert.equal(canApplyAgentRevision(sent, { flowId: 'flow-a', revision: 5 }), false)
  assert.equal(canApplyAgentRevision(sent, { flowId: 'flow-b', revision: 4 }), false)
  assert.equal(canApplyAgentRevision(sent, null), false)
})

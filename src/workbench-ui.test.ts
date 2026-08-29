import test from 'node:test'
import assert from 'node:assert/strict'
import { draftSaveStatus, runStopControl } from '../web/src/workbench-ui.js'

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

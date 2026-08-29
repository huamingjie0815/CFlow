export type RunMode = 'test' | 'live' | null

export function runStopControl(runMode: RunMode, runId: string | null) {
  if (!runMode) return null
  if (!runId) {
    return {
      label: runMode === 'test' ? '正在启动测试' : '正在启动运行',
      disabled: true,
    }
  }
  return {
    label: runMode === 'test' ? '停止测试' : '停止运行',
    disabled: false,
  }
}

export function draftSaveStatus(input: { isPending: boolean; isError: boolean; dirty: boolean }) {
  if (!input.dirty) return null
  if (input.isPending) return '保存中'
  if (input.isError) return '保存失败'
  return '待保存'
}

export function nodeKindLabel(kind: string) {
  return (
    {
      'cf-call': '能力',
      branch: '分支',
      join: '汇合',
      approval: '审批',
      output: '输出',
    }[kind] ?? kind
  )
}

export function joinModeLabel(mode: string) {
  return mode === 'any' ? '任一步完成后继续' : '等所有上一步都完成'
}

export function testStateLabel(state: string) {
  return (
    (
      {
        idle: '还没测试',
        running: '正在测试',
        passed: '测试通过',
        failed: '测试未通过',
        cancelled: '测试已停止',
        published: '已发布',
      } as const
    )[state] ?? state
  )
}

export function runtimeHealthLabel(runtime: { enabled: boolean; health?: { status?: string } }) {
  if (!runtime.enabled || runtime.health?.status === 'disabled') return '已停用'
  if (runtime.health?.status === 'available') return '可用'
  if (runtime.health?.status === 'checking') return '正在检查'
  return '未安装或未登录'
}

export function runStatusLabel(status: string) {
  return (
    {
      queued: '排队中',
      running: '运行中',
      completed: '已完成',
      failed: '未完成',
      cancelled: '已取消',
      'needs-reconciliation': '待处理',
      awaiting_approval: '等待审批',
      'waiting-approval': '等待审批',
    }[status] ?? status
  )
}

export function runtimeBlurb(runtime: { id: string; description?: string }) {
  if (runtime.id === 'codex') return '用本机已登录的 Codex 来执行步骤。默认只读，不会改你的文件。'
  if (runtime.id === 'claude-code') return '用本机已登录的 Claude Code 来执行步骤。'
  return runtime.description || '使用本机当前配置'
}

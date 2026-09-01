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

export function runtimeHealthLabel(runtime: {
  enabled: boolean
  health?: { status?: string; stage?: string }
}) {
  if (!runtime.enabled || runtime.health?.status === 'disabled') return '已停用'
  if (runtime.health?.status === 'available') {
    if (runtime.health.stage === 'protocol-ready') return '已连接'
    if (runtime.health.stage === 'adapter-ready') return '已就绪'
    return '可用'
  }
  if (runtime.health?.status === 'checking') return '正在检查'
  if (runtime.health?.stage === 'installed') return '已安装，但连不上'
  return '本机没有找到'
}

export function runtimeDiscoveryLabel(source?: string) {
  return (
    {
      builtin: '内置支持',
      'path-acp': '系统路径中发现',
      'package-manifest': '安装包自带配置',
      'user-manifest': '你的个人配置',
      'project-manifest': '项目配置',
      manual: '手动配置',
    }[source ?? ''] ?? '本机配置'
  )
}

export function runtimeHealthErrorSummary(error?: string) {
  if (!error) return '连接握手没有完成，请展开技术详情查看原因。'
  if (/BUNDLED_.*NOT_FOUND/.test(error)) return '随 CFlow 安装的助手组件不完整，请重新安装 CFlow。'
  if (/NOT_FOUND|ENOENT/.test(error)) return '没有找到可启动的程序，请确认助手已经正确安装。'
  if (/HANDSHAKE_TIMEOUT/.test(error)) return '助手已经启动，但没有在限定时间内回应。'
  if (/HEALTHCHECK_TIMEOUT/.test(error)) return '助手启动检查超时，请稍后重试。'
  if (/EXITED/.test(error)) return '助手启动后立即退出，可能需要先完成登录或本机配置。'
  return '助手没有完成连接握手，请查看技术详情。'
}

export function runtimeLaunchDetail(runtime: {
  command?: string
  args?: string[]
  health?: { error?: string; version?: string }
}) {
  const failed = runtime.health?.error?.match(/\[launch=([^\]]+)\]/)?.[1]
  if (failed) return failed
  const ready = runtime.health?.version?.match(/(?:^| · )via (.+)$/)?.[1]
  if (ready) return ready
  return `尚未解析 · ${[runtime.command, ...(runtime.args ?? [])].filter(Boolean).join(' ')}`
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
      'waiting-approval': '等待审批',
    }[status] ?? status
  )
}

export function runtimeBlurb(runtime: { id: string; description?: string }) {
  if (runtime.id === 'codex') return '用 CFlow 随附的 Codex 来执行步骤。默认只读，不会改你的文件。'
  if (runtime.id === 'claude-code') return '用 CFlow 随附的 Claude Code 来执行步骤。'
  return runtime.description || '使用本机当前配置'
}

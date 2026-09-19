import { format, messagesFor, type Locale } from './i18n'

const localeOf = (locale?: Locale) => messagesFor(locale)

export function nodeKindLabel(kind: string, locale: Locale = 'zh-CN') {
  const copy = localeOf(locale).nodeKind
  return copy[kind as keyof typeof copy] ?? kind
}

export function joinModeLabel(mode: string, locale: Locale = 'zh-CN') {
  const copy = localeOf(locale).joinMode
  return mode === 'any' ? copy.any : copy.all
}

export function testStateLabel(state: string, locale: Locale = 'zh-CN') {
  const copy = localeOf(locale).testState
  return (
    {
      idle: copy.idle,
      running: copy.running,
      passed: copy.passed,
      failed: copy.failed,
      cancelled: copy.cancelled,
      published: copy.published,
    }[state] ?? state
  )
}

export function runtimeHealthLabel(
  runtime: {
    enabled: boolean
    health?: { status?: string; stage?: string }
  },
  locale: Locale = 'zh-CN',
) {
  const copy = localeOf(locale).runtimeHealth
  if (!runtime.enabled || runtime.health?.status === 'disabled') return copy.disabled
  if (runtime.health?.status === 'available') {
    if (runtime.health.stage === 'protocol-ready') return copy.connected
    if (runtime.health.stage === 'adapter-ready') return copy.ready
    return copy.available
  }
  if (runtime.health?.status === 'checking') return copy.checking
  if (runtime.health?.stage === 'installed') return copy.installed
  return copy.missing
}

export function runtimeDiscoveryLabel(source?: string, locale: Locale = 'zh-CN') {
  const copy = localeOf(locale).discovery
  return (
    {
      builtin: copy.builtin,
      'path-acp': copy['path-acp'],
      'package-manifest': copy['package-manifest'],
      'user-manifest': copy['user-manifest'],
      'project-manifest': copy['project-manifest'],
      manual: copy.manual,
    }[source ?? ''] ?? copy.fallback
  )
}

export function runtimeHealthErrorSummary(error?: string, locale: Locale = 'zh-CN') {
  const copy = localeOf(locale).runtimeError
  if (!error) return copy.handshake
  if (/(?:CLAUDE|AGENT)_AUTH_REQUIRED/.test(error)) return copy.auth
  if (/ASSISTANT_CLI_WINDOWS_SHIM_UNSUPPORTED/.test(error)) return copy.windowsShim
  if (/ASSISTANT_CLI_NOT_FOUND/.test(error)) return copy.cliMissing
  if (/BUNDLED_.*NOT_FOUND/.test(error)) return copy.bundledMissing
  if (/NOT_FOUND|ENOENT/.test(error)) return copy.notFound
  if (/HANDSHAKE_TIMEOUT/.test(error)) return copy.handshakeTimeout
  if (/HEALTHCHECK_TIMEOUT/.test(error)) return copy.healthTimeout
  if (/EXITED/.test(error)) return copy.exited
  return copy.fallback
}

export function runtimeLaunchDetail(
  runtime: {
    command?: string
    args?: string[]
    health?: { error?: string; version?: string }
  },
  locale: Locale = 'zh-CN',
) {
  const failed = runtime.health?.error?.match(/\[launch=([^\]]+)\]/)?.[1]
  if (failed) return failed
  const ready = runtime.health?.version?.match(/(?:^| · )via (.+)$/)?.[1]
  if (ready) return ready
  return format(localeOf(locale).launchUnresolved, {
    command: [runtime.command, ...(runtime.args ?? [])].filter(Boolean).join(' '),
  })
}

export function runStatusLabel(status: string, locale: Locale = 'zh-CN') {
  const copy = localeOf(locale).runStatus
  return (
    {
      queued: copy.queued,
      running: copy.running,
      completed: copy.completed,
      failed: copy.failed,
      cancelled: copy.cancelled,
      'needs-reconciliation': copy['needs-reconciliation'],
    }[status] ?? status
  )
}

export function runtimeBlurb(
  runtime: { id: string; description?: string },
  locale: Locale = 'zh-CN',
) {
  const copy = localeOf(locale).runtimeBlurb
  if (runtime.id === 'codex') return copy.codex
  if (runtime.id === 'claude-code') return copy.claude
  return runtime.description || copy.fallback
}

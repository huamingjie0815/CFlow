import type { AgentTraceEvent, Json } from './types.js'

const SENSITIVE = /password|passphrase|token|secret|authorization|api.?key|cookie/i
const MAX_TECHNICAL_BYTES = 8 * 1024

function redact(value: unknown, key = ''): Json {
  if (SENSITIVE.test(key)) return '[已脱敏]'
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'string' && /^(bearer\s+|sk-[a-z0-9_-]{8,})/i.test(value))
      return '[已脱敏]'
    return value as Json
  }
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([name, item]) => [
        name,
        redact(item, name),
      ]),
    )
  return String(value)
}

export function safeTraceText(value: string) {
  return value
    .replace(/\b(Bearer\s+)[^\s,;]+/gi, '$1[已脱敏]')
    .replace(
      /\b(password|passphrase|token|secret|authorization|api.?key|cookie)\b\s*[:=]\s*[^\s,;]+/gi,
      '$1=[已脱敏]',
    )
    .slice(0, 2000)
}

export function safeTraceEvent(
  event: Omit<AgentTraceEvent, 'invocationId' | 'seq' | 'at'>,
): Omit<AgentTraceEvent, 'invocationId' | 'seq' | 'at'> {
  const base = {
    ...event,
    title: safeTraceText(event.title).slice(0, 160),
    detail: event.detail ? safeTraceText(event.detail) : undefined,
  }
  if (event.technical === undefined) return base
  const safe = redact(event.technical)
  const encoded = JSON.stringify(safe)
  return {
    ...base,
    technical:
      Buffer.byteLength(encoded, 'utf8') <= MAX_TECHNICAL_BYTES
        ? safe
        : { truncated: true, preview: encoded.slice(0, MAX_TECHNICAL_BYTES - 128) },
  }
}

import type { FastifyReply } from 'fastify'

/** Own the raw response until completion or disconnect, including timer failures. */
export function startEventStream(reply: FastifyReply, flush: () => boolean, onClose: () => void) {
  reply.hijack()
  const raw = reply.raw
  let timer: ReturnType<typeof setInterval> | undefined
  let closed = false
  const cleanup = () => {
    if (closed) return
    closed = true
    clearInterval(timer)
    raw.off('close', cleanup)
    raw.off('finish', cleanup)
    raw.off('error', fail)
    onClose()
  }
  const close = () => {
    cleanup()
    if (!raw.destroyed && !raw.writableEnded) raw.end()
  }
  const fail = (err: unknown) => {
    if (closed) return
    reply.log.error({ err }, 'Event stream failed')
    cleanup()
    raw.destroy()
  }
  const tick = () => {
    if (closed || raw.destroyed || raw.writableEnded) return cleanup()
    try {
      if (flush()) close()
    } catch (err) {
      fail(err)
    }
  }
  raw.once('close', cleanup)
  raw.once('finish', cleanup)
  raw.once('error', fail)
  try {
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    raw.flushHeaders()
    tick()
    if (!closed) timer = setInterval(tick, 100)
  } catch (err) {
    fail(err)
  }
  return close
}

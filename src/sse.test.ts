import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { Store } from './db.js'
import { createApp } from './server.js'

async function fixture(t: TestContext) {
  const store = new Store(':memory:')
  const app = createApp(store)
  const errors: unknown[] = []
  const warnings: unknown[] = []
  app.addHook('onRequest', async (req) => {
    t.mock.method(req.log, 'error', (...args: unknown[]) => errors.push(args))
    t.mock.method(req.log, 'warn', (...args: unknown[]) => warnings.push(args))
  })
  store.createAgentInvocation({ id: 'agent', kind: 'flow-assistant', status: 'running' })
  store.appendAgentTrace('agent', { kind: 'stage', title: 'First' })
  store.createRun('run', 'test')
  store.append('run', 'run.started')
  t.after(async () => {
    await app.close()
    store.close()
  })
  await app.ready()
  return { app, store, errors, warnings }
}

test('already completed agent SSE ends once, resumes by event ID, and does not double-send', async (t) => {
  const { app, store, errors, warnings } = await fixture(t)
  store.appendAgentTrace('agent', { kind: 'stage', title: 'Second' })
  store.setAgentInvocation('agent', 'completed')
  const response = await app.inject({
    url: '/api/agent-invocations/agent/events',
    headers: { 'last-event-id': '1' },
  })
  await delay(0)
  assert.equal(response.statusCode, 200)
  assert.match(response.headers['content-type']!, /text\/event-stream/)
  assert.doesNotMatch(response.body, /id: 1\n/)
  assert.match(response.body, /id: 2\n/)
  assert.equal(response.body.match(/event: complete/g)?.length, 1)
  assert.deepEqual(errors, [])
  assert.deepEqual(warnings, [])
})

for (const kind of ['agent', 'run'] as const) {
  const url = kind === 'agent' ? '/api/agent-invocations/agent/events' : '/api/runs/run/events'
  test(`${kind} SSE stays open for later events and closes on completion`, async (t) => {
    const { app, store, errors, warnings } = await fixture(t)
    const address = await app.listen({ host: '127.0.0.1', port: 0 })
    const response = await fetch(address + url, { signal: AbortSignal.timeout(3000) })
    assert.equal(response.status, 200)
    await delay(140)
    if (kind === 'agent') {
      store.appendAgentTrace('agent', { kind: 'stage', title: 'Later' })
      store.setAgentInvocation('agent', 'completed')
    } else {
      store.append('run', 'run.completed')
      store.setRun('run', 'completed')
    }
    const body = await response.text()
    assert.match(body, /id: 1\n/)
    assert.match(body, /id: 2\n/)
    assert.deepEqual(errors, [])
    assert.deepEqual(warnings, [])
  })

  test(`${kind} SSE stops polling after client disconnect`, async (t) => {
    const { app, store, errors } = await fixture(t)
    const reads = t.mock.method(store, kind === 'agent' ? 'agentTraceEvents' : 'events')
    const address = await app.listen({ host: '127.0.0.1', port: 0 })
    const controller = new AbortController()
    const response = await fetch(address + url, { signal: controller.signal })
    const reader = response.body!.getReader()
    await reader.read()
    controller.abort()
    await delay(140)
    const count = reads.mock.callCount()
    await delay(220)
    assert.equal(reads.mock.callCount(), count)
    assert.deepEqual(errors, [])
  })
}

test('SSE poll failure is logged once and closes the stream', async (t) => {
  const { app, store, errors } = await fixture(t)
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  const response = await fetch(address + '/api/agent-invocations/agent/events', {
    signal: AbortSignal.timeout(3000),
  })
  const body = response.text()
  t.mock.method(store, 'agentTraceEvents', () => {
    throw new Error('test stream failure')
  })
  await assert.rejects(body)
  await delay(220)
  assert.equal(errors.length, 1)
})

test('server shutdown closes active SSE connections', async (t) => {
  const { app, errors } = await fixture(t)
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  const response = await fetch(address + '/api/agent-invocations/agent/events', {
    signal: AbortSignal.timeout(3000),
  })
  await app.close()
  assert.match(await response.text(), /id: 1\n/)
  assert.deepEqual(errors, [])
})

test('missing streams return JSON 404 before taking over the response', async (t) => {
  const { app } = await fixture(t)
  for (const url of ['/api/agent-invocations/missing/events', '/api/runs/missing/events']) {
    const response = await app.inject({ url })
    assert.equal(response.statusCode, 404)
    assert.match(response.headers['content-type']!, /application\/json/)
  }
})

test('request exceptions still log with error-only logging enabled', async (t) => {
  const { app, errors } = await fixture(t)
  assert.equal(app.log.level, 'error')
  const response = await app.inject({ method: 'POST', url: '/api/resources', payload: {} })
  assert.equal(response.statusCode, 400)
  assert.equal(errors.length, 1)
})

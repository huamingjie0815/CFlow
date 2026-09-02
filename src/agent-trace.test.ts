import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Store } from './db.js'
import { safeTraceEvent } from './agent-trace.js'

test('redacts sensitive trace fields recursively', () => {
  const event = safeTraceEvent({
    kind: 'tool',
    title: '调用接口',
    technical: { authorization: 'Bearer private', nested: { apiKey: 'sk-private', path: 'ok' } },
  })
  assert.deepEqual(event.technical, {
    authorization: '[已脱敏]',
    nested: { apiKey: '[已脱敏]', path: 'ok' },
  })
})

test('persists invocation events and marks unfinished work interrupted on reopen', () => {
  const file = `/tmp/cflow-agent-trace-${randomUUID()}.sqlite`
  const first = new Store(file)
  first.createAgentInvocation({ id: 'call-1', kind: 'flow-assistant', status: 'running' })
  first.appendAgentTrace('call-1', { kind: 'stage', title: '正在处理', status: 'running' })
  assert.equal(first.agentTraceEvents('call-1').length, 1)
  first.close()
  const reopened = new Store(file)
  assert.equal(reopened.agentInvocation('call-1')?.status, 'interrupted')
  reopened.close()
})

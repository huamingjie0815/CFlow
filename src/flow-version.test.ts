import test from 'node:test'
import assert from 'node:assert/strict'
import { Store } from './db.js'
import { createApp } from './server.js'
import { compileFlow } from './compiler.js'
import { sha256 } from './hash.js'
import type { FlowDraft, FlowPlan } from './types.js'

const draft: FlowDraft = {
  flowId: 'version-test',
  revision: 99,
  name: 'Version test',
  objective: 'Return result',
  workspaceRoot: process.cwd(),
  nodes: [{ id: 'out', kind: 'output', outputId: 'result' }],
  edges: [{ id: 'entry', from: '$entry', to: 'out' }],
}

test('compilation version does not depend on draft revisions', () => {
  const first = compileFlow(draft, new Map())
  assert.equal(first.flowVersion, '1.0.0')
  assert.deepEqual(compileFlow({ ...draft, revision: 1000 }, new Map()), first)
  const explicit = compileFlow(draft, new Map(), { flowVersion: '12.0.0' })
  assert.equal(explicit.flowVersion, '12.0.0')
  const { planHash, ...body } = explicit
  assert.equal(planHash, sha256(body))
})

test('publication increments per flow and ignores edits, previews, tests and failed publications', async (t) => {
  const store = new Store(':memory:')
  const app = createApp(store)
  t.after(async () => {
    await app.close()
    store.close()
  })

  const publish = async (value: FlowDraft) => {
    const response = await app.inject({ method: 'POST', url: '/api/flows', payload: value })
    assert.equal(response.statusCode, 200, response.body)
    const plan = response.json<FlowPlan>()
    const { planHash, ...body } = plan
    assert.equal(planHash, sha256(body))
    return plan
  }

  assert.equal((await publish(draft)).flowVersion, '1.0.0')
  const edited = { ...draft, revision: 999 }
  for (const url of ['/api/flow-compilations', '/api/flow-tests']) {
    const response = await app.inject({ method: 'POST', url, payload: { flowDraft: edited } })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().plan.flowVersion, '2.0.0')
  }
  const failed = await app.inject({
    method: 'POST',
    url: '/api/flows',
    payload: { ...edited, nodes: [] },
  })
  assert.equal(failed.statusCode, 400)
  assert.equal((await publish(edited)).flowVersion, '2.0.0')
  assert.equal((await publish(edited)).flowVersion, '3.0.0')
  assert.equal((await publish({ ...edited, flowId: 'another' })).flowVersion, '1.0.0')
})

test('publication continues after the highest existing version and preserves it', async (t) => {
  const store = new Store(':memory:')
  const historical = compileFlow(draft, new Map(), { flowVersion: '11.0.0' })
  store.save('flow_versions', `${draft.flowId}@11.0.0`, historical)
  const app = createApp(store)
  t.after(async () => {
    await app.close()
    store.close()
  })

  const responses = await Promise.all(
    [1, 2].map((revision) =>
      app.inject({ method: 'POST', url: '/api/flows', payload: { ...draft, revision } }),
    ),
  )
  for (const response of responses) assert.equal(response.statusCode, 200, response.body)
  assert.deepEqual(responses.map((response) => response.json<FlowPlan>().flowVersion).sort(), [
    '12.0.0',
    '13.0.0',
  ])
  assert.deepEqual(store.get('flow_versions', `${draft.flowId}@11.0.0`), historical)
  assert.equal(store.list<FlowPlan>('flow_versions').length, 3)
})

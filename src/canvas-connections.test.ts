import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidCanvasConnection, reconnectCanvasEdge } from '../web/src/workbench-ui.js'
import type { FlowDraft } from './types.js'

const draft: FlowDraft = {
  flowId: 'reconnect',
  revision: 3,
  name: 'Reconnect',
  objective: '',
  workspaceRoot: '/tmp',
  nodes: ['a', 'b', 'c'].map((id) => ({ id, kind: 'output', outputId: id })),
  edges: [
    { id: 'entry', from: '$entry', to: 'a' },
    { id: 'route', from: 'a', to: 'b', when: { outcome: 'branch-case', caseId: 'yes' } },
    { id: 'other', from: 'a', to: 'c' },
  ],
}

test('reconnects either end while preserving identity, conditions and other edges', () => {
  for (const connection of [
    { source: 'c', target: 'b' },
    { source: 'a', target: 'c' },
  ]) {
    const input = { ...draft, edges: draft.edges.slice(0, 2) }
    const next = reconnectCanvasEdge(input, 'route', connection)
    assert.equal(next.revision, 4)
    assert.equal(next.edges.length, 2)
    assert.deepEqual(next.edges[1], {
      ...input.edges[1],
      from: connection.source,
      to: connection.target,
    })
    assert.equal(next.edges[0], input.edges[0])
    assert.equal(input.edges[1].to, 'b')
  }
})

test('entry allows moving its target but not its source', () => {
  assert.equal(
    reconnectCanvasEdge(draft, 'entry', { source: '$entry', target: 'b' }).edges[0].to,
    'b',
  )
  assert.equal(reconnectCanvasEdge(draft, 'entry', { source: 'c', target: 'a' }), draft)
})

test('invalid and unchanged reconnects leave the draft untouched', () => {
  for (const connection of [
    { source: 'a', target: 'a' },
    { source: 'a', target: 'c' },
    { source: 'a', target: 'b' },
    { source: null, target: 'b' },
    { source: 'missing', target: 'b' },
    { source: 'a', target: '$entry' },
  ])
    assert.equal(reconnectCanvasEdge(draft, 'route', connection), draft)
  assert.equal(reconnectCanvasEdge(draft, 'missing', { source: 'c', target: 'b' }), draft)
  assert.equal(isValidCanvasConnection(draft, { source: 'a', target: 'b' }), false)
  assert.equal(isValidCanvasConnection(draft, { source: 'a', target: 'b' }, 'route'), true)
})

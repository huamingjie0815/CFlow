import test from 'node:test'
import assert from 'node:assert/strict'
import { describeNode, edgeLabel, nodeConfigNote } from '../web/src/flow-labels.js'
import type { CFDraft, CFVersion, FlowNode } from '../web/src/types.js'

/**
 * The workbench is used by colleagues who do not write code, so no internal
 * identifier may surface as a node title or an edge label. These tests pin that.
 */

const capability = (id: string, name: string, does: string): CFVersion =>
  ({
    cfId: id,
    version: '1.0.0',
    programHash: 'sha256:x',
    createdAt: '',
    program: { version: '0.2', cfId: id, sourceRevision: 1, task: does },
    draft: { cfId: id, revision: 1, name, does },
  }) as unknown as CFVersion

test('a step is titled by its own name, never by the capability id', () => {
  const node: FlowNode = {
    id: 'step-1',
    kind: 'cf-call',
    name: '读取入职资料',
    cfRef: { cfId: 'cf-a1b2c3', version: '1.0.0' },
  }
  const copy = describeNode(node, [], [])
  assert.equal(copy.label, '读取入职资料')
  assert.doesNotMatch(copy.label, /cf-a1b2c3/)
})

test('falls back to the capability name, then to a plain placeholder', () => {
  const withVersion: FlowNode = {
    id: 'step-1',
    kind: 'cf-call',
    cfRef: { cfId: 'cf-sum', version: '1.0.0' },
  }
  const fromCatalog = describeNode(
    withVersion,
    [capability('cf-sum', '汇总台账', '汇总本月台账')],
    [],
  )
  assert.equal(fromCatalog.label, '汇总台账')
  assert.equal(fromCatalog.subtitle, '汇总本月台账')

  const draft: CFDraft = { cfId: 'cf-new', revision: 1, name: '草稿能力', does: '做一件事' }
  const fromDraft = describeNode(
    { id: 'step-2', kind: 'cf-call', cfRef: { cfId: 'cf-new', version: '1.0.0' } },
    [],
    [draft],
  )
  assert.equal(fromDraft.label, '草稿能力')

  // Nothing known anywhere: still no identifier leaks into the title.
  const unknown = describeNode(
    { id: 'step-3', kind: 'cf-call', cfRef: { cfId: 'cf-ghost', version: '1.0.0' } },
    [],
    [],
  )
  assert.equal(unknown.label, '新步骤')
  assert.doesNotMatch(unknown.label + unknown.subtitle, /cf-ghost/)
})

test('branch and output read as plain language', () => {
  const branch = describeNode(
    {
      id: 'b',
      kind: 'branch',
      cond: { $get: 'risk' },
      cases: ['high', 'low'],
      caseConditions: { high: '金额超过 2000 元', low: '金额在 2000 元以内' },
    },
    [],
    [],
  )
  assert.equal(branch.subtitle, '金额超过 2000 元 · 金额在 2000 元以内')

  const output = describeNode({ id: 'o', kind: 'output', outputId: 'result' }, [], [])
  assert.doesNotMatch(output.label + output.subtitle, /result/)
})

test('a branch edge shows the routing rule, falling back to the case id', () => {
  const nodes: FlowNode[] = [
    {
      id: 'b',
      kind: 'branch',
      cond: { $get: 'risk' },
      cases: ['high', 'low'],
      caseConditions: { high: '金额超过 2000 元' },
    },
  ]
  assert.equal(
    edgeLabel(
      { id: 'e1', from: 'b', to: 'x', when: { outcome: 'branch-case', caseId: 'high' } },
      nodes,
    ),
    '金额超过 2000 元',
  )
  // No condition written for `low`, so the id is the honest last resort.
  assert.equal(
    edgeLabel(
      { id: 'e2', from: 'b', to: 'y', when: { outcome: 'branch-case', caseId: 'low' } },
      nodes,
    ),
    'low',
  )
  assert.equal(edgeLabel({ id: 'e3', from: 'b', to: 'z' }, nodes), undefined)
})

test('the config chip prefers the retry policy over the executor', () => {
  assert.equal(
    nodeConfigNote({
      id: 's',
      kind: 'cf-call',
      cfRef: { cfId: 'c', version: '1.0.0' },
      executor: 'codex',
      onError: { action: 'retry', maxAttempts: 3 },
    }),
    '失败时重试 3 次',
  )
  assert.equal(
    nodeConfigNote({
      id: 's',
      kind: 'cf-call',
      cfRef: { cfId: 'c', version: '1.0.0' },
      executor: 'codex',
    }),
    '由 codex 执行',
  )
  assert.equal(
    nodeConfigNote({
      id: 's',
      kind: 'cf-call',
      cfRef: { cfId: 'c', version: '1.0.0' },
      executor: 'cflow-demo',
    }),
    '演示执行，不调用本机助手',
  )
  assert.equal(nodeConfigNote({ id: 'o', kind: 'output', outputId: 'result' }), undefined)
})

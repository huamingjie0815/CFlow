import test from 'node:test'
import assert from 'node:assert/strict'
import { compileCF } from './compiler.js'
import { flowAgentContext, flowAgentFallback, normalizeAgentResponse } from './flow-agent.js'
import type { CFDraft, FlowDraft } from './types.js'

const candidate: CFDraft = {
  cfId: 'candidate-review',
  revision: 3,
  name: '复核结果',
  does: '检查摘要是否覆盖关键事实',
  input: '摘要和原文',
  output: '复核结论',
  process: '逐条核对事实。',
}

const published = compileCF({
  cfId: 'published-summarize',
  revision: 2,
  name: '整理材料',
  does: '把原始材料整理成结构化摘要',
  input: '原始材料',
  output: '结构化摘要',
  process: '提取主题、事实和出处。',
})

const draft: FlowDraft = {
  flowId: 'current-flow',
  revision: 7,
  name: '当前屏幕稿',
  objective: '整理并复核材料',
  workspaceRoot: process.cwd(),
  resources: [{ id: 'docs', type: 'folder', access: 'read', required: true }],
  limits: { maxConcurrency: 2 },
  nodes: [
    {
      id: 'summarize',
      kind: 'cf-call',
      cfRef: { cfId: published.cfId, version: published.version },
      executor: 'codex',
    },
    {
      id: 'review',
      name: '人工命名的第二步',
      kind: 'cf-call',
      cfRef: { cfId: candidate.cfId, version: '3.0.0' },
      executor: 'claude',
    },
    {
      id: 'route',
      kind: 'branch',
      cond: { $get: 'risk' },
      cases: ['high', 'low'],
      caseConditions: { high: '风险较高', low: '风险可接受' },
    },
    { id: 'output', kind: 'output', outputId: 'result' },
  ],
  edges: [{ id: 'entry', from: '$entry', to: 'summarize' }],
}

test('agent context carries the current draft and completed published/candidate step bodies', () => {
  const context = flowAgentContext(
    {
      message: '第二步做什么？',
      flowDraft: draft,
      cfDrafts: [candidate],
      conversation: Array.from({ length: 10 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        body: `turn-${index}`,
      })),
      selection: { nodeId: 'review', edgeId: null },
      check: { error: 'CF_INPUT_MISMATCH' },
      runDetail: {
        run: { status: 'failed', flow_version_id: 'current-flow@7' },
        events: Array.from({ length: 30 }, (_, index) => ({ type: `event-${index}` })),
      },
    },
    [
      { id: 'codex', name: 'Codex' },
      { id: 'claude', name: 'Claude' },
    ],
    [published],
  ) as any

  assert.equal(context.flow.revision, 7)
  assert.equal(context.flow.workspaceRoot, process.cwd())
  assert.equal(context.steps[0].name, '整理材料')
  assert.equal(context.steps[0].does, '把原始材料整理成结构化摘要')
  assert.equal(context.steps[1].name, '人工命名的第二步')
  assert.equal(context.steps[1].does, candidate.does)
  assert.equal(context.steps[2].caseConditions.high, '风险较高')
  assert.equal(context.conversation.length, 8)
  assert.equal(context.conversation[0].body, 'turn-2')
  assert.equal(context.run.events.length, 24)
  assert.equal(context.run.events[0].type, 'event-6')
  assert.deepEqual(context.selection, { nodeId: 'review', edgeId: null })
  assert.equal(context.check.error, 'CF_INPUT_MISMATCH')
})

test('fallback never invents a retry revision', () => {
  const response = flowAgentFallback(
    {
      message: '把第二步改一下',
      flowDraft: draft,
      cfDrafts: [candidate],
    },
    [published],
  )
  assert.equal(response.intent, 'answer')
  assert.deepEqual(response.stages, [])
  assert.doesNotMatch(response.message, /重试/)
})

test('normalizer ignores stages for answers and rejects empty revisions', () => {
  assert.deepEqual(
    normalizeAgentResponse({
      message: '只回答',
      intent: 'answer',
      stages: [{ kind: 'cf-call', name: 'x', does: 'y', cfId: null }],
    }),
    { message: '只回答', intent: 'answer', stages: [] },
  )
  assert.throws(
    () => normalizeAgentResponse({ message: '修改', intent: 'revise', stages: [] }),
    /RUNTIME_REVISION_EMPTY/,
  )
})

test('normalizer preserves branch routes for a Flow revision', () => {
  const response = normalizeAgentResponse({
    message: '按是否需要提醒重新编排。',
    intent: 'revise',
    stages: [
      {
        kind: 'branch',
        name: '是否需要提醒',
        does: null,
        cfId: null,
        cond: 'needsReminder',
        routes: [
          {
            caseId: 'skip',
            condition: '不需要提醒，直接结束',
            endsFlow: true,
            stages: [],
          },
          {
            caseId: 'send',
            condition: '需要提醒',
            endsFlow: false,
            stages: [{ kind: 'cf-call', name: '发送提醒', does: '发送提醒邮件', cfId: null }],
          },
        ],
      },
    ],
  })

  assert.equal(response.stages[0].kind, 'branch')
  assert.equal(response.stages[0].routes[0].endsFlow, true)
  assert.equal(response.stages[0].routes[1].stages[0].name, '发送提醒')
})

test('normalizer rejects a partial revision when one branch is invalid', () => {
  assert.throws(
    () =>
      normalizeAgentResponse({
        message: '重新编排',
        intent: 'revise',
        stages: [
          { kind: 'cf-call', name: '保留步骤', does: '执行任务', cfId: null },
          {
            kind: 'branch',
            name: '不完整分支',
            cond: 'route',
            routes: [{ caseId: 'only', condition: '只有一条路径', endsFlow: true, stages: [] }],
          },
        ],
      }),
    /RUNTIME_REVISION_STAGE_INVALID/,
  )
})

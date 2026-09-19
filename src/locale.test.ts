import test from 'node:test'
import assert from 'node:assert/strict'
import { detectCliLocale, format, normalizeLocale } from './locale.js'
import { createHelloWorldDemoFlow } from './demo-flow.js'
import { builtinCapabilities } from './builtin-catalog.js'
import { flowProposalPrompt } from './proposal.js'
import { nodeKindLabel, runStatusLabel } from '../web/src/copy.js'
import { readableError } from '../web/src/api.js'
import { catalogs, messagesFor } from '../web/src/i18n.js'

test('normalizeLocale accepts en and falls back to zh-CN', () => {
  assert.equal(normalizeLocale('en'), 'en')
  assert.equal(normalizeLocale('zh-CN'), 'zh-CN')
  assert.equal(normalizeLocale('fr'), 'zh-CN')
  assert.equal(normalizeLocale(''), 'zh-CN')
  assert.equal(normalizeLocale(undefined), 'zh-CN')
})

test('detectCliLocale treats missing or zh LANG as Chinese', () => {
  assert.equal(detectCliLocale({}), 'zh-CN')
  assert.equal(detectCliLocale({ LANG: 'zh_CN.UTF-8' }), 'zh-CN')
  assert.equal(detectCliLocale({ LANG: 'en_US.UTF-8' }), 'en')
  assert.equal(detectCliLocale({ LC_ALL: 'en_GB.UTF-8', LANG: 'zh_CN.UTF-8' }), 'en')
})

test('format substitutes named placeholders', () => {
  assert.equal(format('有 {count} 个步骤', { count: 7 }), '有 7 个步骤')
  assert.equal(format('hello {name}', { name: 'Ada' }), 'hello Ada')
})

test('English catalogs are not Chinese for chrome copy', () => {
  const en = messagesFor('en')
  assert.equal(en.canvas.check, 'Check')
  assert.equal(en.topBar.addDemo, 'Add example')
  assert.doesNotMatch(en.settings.title, /[\u4e00-\u9fff]/)
  assert.equal(catalogs['zh-CN'].canvas.check, '检查')
})

test('node and run labels switch with locale', () => {
  assert.equal(nodeKindLabel('cf-call'), '能力')
  assert.equal(nodeKindLabel('cf-call', 'en'), 'Capability')
  assert.equal(runStatusLabel('completed'), '已完成')
  assert.equal(runStatusLabel('completed', 'en'), 'Completed')
})

test('readableError maps codes in the active locale', () => {
  assert.match(readableError(new Error('OBJECTIVE_REQUIRED')), /写下/)
  assert.match(readableError(new Error('OBJECTIVE_REQUIRED'), 'en'), /Write what you want/)
})

test('demo flow is English when locale is en', () => {
  const { flowDraft, cfDrafts } = createHelloWorldDemoFlow('/tmp/cflow-demo', 'en')
  assert.equal(flowDraft.name, 'Example: write a Hello World page')
  assert.doesNotMatch(flowDraft.objective, /[\u4e00-\u9fff]/)
  assert.equal(cfDrafts[0].name, 'Choose a page theme')
  const branch = flowDraft.nodes.find((node) => node.kind === 'branch')
  assert.ok(branch && branch.kind === 'branch')
  assert.equal(branch.caseConditions?.illustrated, 'Need an illustrated page')
})

test('builtin catalog localizes display copy', () => {
  assert.equal(builtinCapabilities('zh-CN')[0].draft.name, '文件内容提取')
  assert.equal(builtinCapabilities('en')[0].draft.name, 'Extract file contents')
})

test('proposal prompt asks for English copy in English locale', () => {
  const prompt = flowProposalPrompt(false, 'en')
  assert.match(prompt, /in English/)
  assert.doesNotMatch(prompt, /Simplified Chinese/)
})

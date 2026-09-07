import test from 'node:test'
import assert from 'node:assert/strict'
import { compileCF, compileFlow } from './compiler.js'
import {
  createHelloWorldDemoFlow,
  helloWorldDemoCapabilityIds,
  isHelloWorldDemoFlowId,
} from './demo-flow.js'
import { DEMO_RUNTIME_ID } from './demo-runtime.js'

test('demo flow covers automatic orchestration node kinds and compiles', () => {
  const { flowDraft, cfDrafts } = createHelloWorldDemoFlow('/tmp/cflow-demo')
  const kinds = new Set(flowDraft.nodes.map((node) => node.kind))
  assert.deepEqual([...kinds].sort(), ['branch', 'cf-call', 'join', 'output'])

  const branch = flowDraft.nodes.find((node) => node.kind === 'branch')
  assert.ok(branch && branch.kind === 'branch')
  assert.deepEqual(branch.cases, ['illustrated', 'plain'])
  assert.equal(branch.caseConditions?.illustrated, '需要插图版页面')
  assert.equal(branch.caseConditions?.plain, '只要纯文本页面')

  const join = flowDraft.nodes.find((node) => node.kind === 'join')
  assert.ok(join && join.kind === 'join')
  assert.equal(join.mode, 'all')

  assert.ok(flowDraft.edges.some((edge) => edge.from === 'join' && edge.to === 'assemble'))

  assert.ok(
    flowDraft.nodes.every((node) => node.kind !== 'cf-call' || node.executor === DEMO_RUNTIME_ID),
  )
  assert.ok(cfDrafts.every((cf) => cf.defaultExecutor === DEMO_RUNTIME_ID))
  assert.equal(cfDrafts.length, 5)
  assert.equal(isHelloWorldDemoFlowId(flowDraft.flowId), true)
  assert.deepEqual(
    cfDrafts.map((cf) => cf.cfId),
    helloWorldDemoCapabilityIds(flowDraft.flowId),
  )

  const versions = new Map(
    cfDrafts.map((draft) => {
      const version = compileCF(draft)
      return [`${version.cfId}@${version.version}`, version] as const
    }),
  )
  const plan = compileFlow(flowDraft, versions)
  assert.equal(plan.nodes.length, flowDraft.nodes.length)
  assert.equal(plan.limits.maxConcurrency, 2)
})

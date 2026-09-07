import { randomUUID } from 'node:crypto'
import { DEMO_RUNTIME_ID } from './demo-runtime.js'
import type { CFDraft, FlowDraft, FlowEdge, FlowNode } from './types.js'

const objectContract = { type: 'object' } as const
const demoFlowIdPattern = /^cflow-demo-[0-9a-f]{8}$/

export const isHelloWorldDemoFlowId = (flowId: string) => demoFlowIdPattern.test(flowId)

export const helloWorldDemoCapabilityIds = (flowId: string) =>
  isHelloWorldDemoFlowId(flowId)
    ? ['theme', 'html', 'greeting', 'assemble', 'plain'].map((suffix) => `${flowId}-${suffix}`)
    : []

const capability = (
  cfId: string,
  name: string,
  does: string,
  input: string,
  output: string,
): CFDraft => ({
  cfId,
  revision: 1,
  name,
  does,
  input,
  output,
  inputContract: objectContract,
  outputContract: objectContract,
  defaultExecutor: DEMO_RUNTIME_ID,
})

export function createHelloWorldDemoFlow(workspaceRoot: string): {
  flowDraft: FlowDraft
  cfDrafts: CFDraft[]
} {
  const token = randomUUID().slice(0, 8)
  const flowId = `cflow-demo-${token}`
  const [theme, html, greeting, assemble, plain] = helloWorldDemoCapabilityIds(flowId)
  const ids = { theme, html, greeting, assemble, plain }
  const cfDrafts = [
    capability(
      ids.theme,
      '拟定页面主题',
      '根据目标确定 Hello World 页面的标题、问候语和样式路线',
      '流程目标',
      '页面标题、问候语，以及插图版或纯文本的样式选择',
    ),
    capability(
      ids.html,
      '写 HTML 骨架',
      '写出插图版 Hello World 页面的基本 HTML 结构',
      '已确定的页面主题',
      '页面骨架',
    ),
    capability(
      ids.greeting,
      '写欢迎文案',
      '写出插图版页面上的欢迎文字',
      '已确定的页面主题',
      '欢迎文案',
    ),
    capability(
      ids.assemble,
      '汇总成完整页面',
      '把骨架和文案汇总成一份完整的 Hello World 页面',
      'HTML 骨架与欢迎文案',
      '完整页面 HTML',
    ),
    capability(
      ids.plain,
      '写纯文本页面',
      '写出不含插图的纯文本 Hello World 页面',
      '已确定的页面主题',
      '纯文本页面 HTML',
    ),
  ]
  const call = (id: string, cfId: string, name: string): FlowNode => ({
    id,
    name,
    kind: 'cf-call',
    cfRef: { cfId, version: '1.0.0' },
    executor: DEMO_RUNTIME_ID,
  })
  const nodes: FlowNode[] = [
    call('theme', ids.theme, '拟定页面主题'),
    {
      id: 'style-branch',
      kind: 'branch',
      cond: { $get: 'pageStyle' },
      cases: ['illustrated', 'plain'],
      caseConditions: {
        illustrated: '需要插图版页面',
        plain: '只要纯文本页面',
      },
    },
    call('html-frame', ids.html, '写 HTML 骨架'),
    call('greeting', ids.greeting, '写欢迎文案'),
    { id: 'join', kind: 'join', mode: 'all' },
    call('assemble', ids.assemble, '汇总成完整页面'),
    call('plain-page', ids.plain, '写纯文本页面'),
    { id: 'output', kind: 'output', outputId: 'result' },
  ]
  const edge = (
    id: string,
    from: string | '$entry',
    to: string,
    when?: FlowEdge['when'],
  ): FlowEdge => ({ id, from, to, ...(when ? { when } : {}) })
  const edges: FlowEdge[] = [
    edge('entry', '$entry', 'theme'),
    edge('theme-branch', 'theme', 'style-branch'),
    edge('branch-html', 'style-branch', 'html-frame', {
      outcome: 'branch-case',
      caseId: 'illustrated',
    }),
    edge('branch-greeting', 'style-branch', 'greeting', {
      outcome: 'branch-case',
      caseId: 'illustrated',
    }),
    edge('html-join', 'html-frame', 'join'),
    edge('greeting-join', 'greeting', 'join'),
    edge('join-assemble', 'join', 'assemble'),
    edge('assemble-output', 'assemble', 'output'),
    edge('branch-plain', 'style-branch', 'plain-page', {
      outcome: 'branch-case',
      caseId: 'plain',
    }),
    edge('plain-output', 'plain-page', 'output'),
  ]
  return {
    flowDraft: {
      flowId,
      revision: 1,
      name: '示例：写出 Hello World 页面',
      objective: '写出一个 Hello World 页面，用来熟悉检查、分支、并行汇合和试运行',
      workspaceRoot,
      nodes,
      edges,
      limits: { maxConcurrency: 2, maxNodeDispatches: 32 },
    },
    cfDrafts,
  }
}

import { randomUUID } from 'node:crypto'
import { DEMO_RUNTIME_ID } from './demo-runtime.js'
import { demoCopy, normalizeLocale, type Locale } from './locale.js'
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

export function createHelloWorldDemoFlow(
  workspaceRoot: string,
  locale: Locale = 'zh-CN',
): {
  flowDraft: FlowDraft
  cfDrafts: CFDraft[]
} {
  const copy = demoCopy[normalizeLocale(locale)]
  const token = randomUUID().slice(0, 8)
  const flowId = `cflow-demo-${token}`
  const [theme, html, greeting, assemble, plain] = helloWorldDemoCapabilityIds(flowId)
  const ids = { theme, html, greeting, assemble, plain }
  const cfDrafts = [
    capability(ids.theme, copy.themeName, copy.themeDoes, copy.themeInput, copy.themeOutput),
    capability(ids.html, copy.htmlName, copy.htmlDoes, copy.htmlInput, copy.htmlOutput),
    capability(
      ids.greeting,
      copy.greetingName,
      copy.greetingDoes,
      copy.greetingInput,
      copy.greetingOutput,
    ),
    capability(
      ids.assemble,
      copy.assembleName,
      copy.assembleDoes,
      copy.assembleInput,
      copy.assembleOutput,
    ),
    capability(ids.plain, copy.plainName, copy.plainDoes, copy.plainInput, copy.plainOutput),
  ]
  const call = (id: string, cfId: string, name: string): FlowNode => ({
    id,
    name,
    kind: 'cf-call',
    cfRef: { cfId, version: '1.0.0' },
    executor: DEMO_RUNTIME_ID,
  })
  const nodes: FlowNode[] = [
    call('theme', ids.theme, copy.themeName),
    {
      id: 'style-branch',
      kind: 'branch',
      cond: { $get: 'pageStyle' },
      cases: ['illustrated', 'plain'],
      caseConditions: {
        illustrated: copy.illustrated,
        plain: copy.plainRoute,
      },
    },
    call('html-frame', ids.html, copy.htmlName),
    call('greeting', ids.greeting, copy.greetingName),
    { id: 'join', kind: 'join', mode: 'all' },
    call('assemble', ids.assemble, copy.assembleName),
    call('plain-page', ids.plain, copy.plainName),
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
      name: copy.flowName,
      objective: copy.objective,
      workspaceRoot,
      nodes,
      edges,
      limits: { maxConcurrency: 2, maxNodeDispatches: 32 },
    },
    cfDrafts,
  }
}

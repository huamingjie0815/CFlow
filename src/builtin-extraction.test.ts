import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { builtinCapabilities } from './builtin-catalog.js'
import { compileCF, compileFlow } from './compiler.js'
import { Store } from './db.js'
import { Engine, ExecutorRegistry } from './engine.js'
import { createApp } from './server.js'
import { applyFlowRevision, buildProposalGraph } from './proposal.js'
import { flowAgentContext } from './flow-agent.js'
import { sha256 } from './hash.js'
import type { FlowDraft, FileExtractionResult } from './types.js'

const builtin = builtinCapabilities()[0]
const catalog = new Map([[`${builtin.cfId}@${builtin.version}`, builtin]])
function draft(root: string): FlowDraft {
  return {
    flowId: randomUUID(),
    revision: 1,
    name: '文件提取测试',
    objective: '提取办公文档',
    workspaceRoot: root,
    nodes: [
      {
        id: 'extract',
        kind: 'cf-call',
        cfRef: { cfId: builtin.cfId, version: builtin.version },
        executor: 'must-not-run',
        toolInput: { source: { kind: 'files', paths: ['document.txt'] } },
      },
      { id: 'out', kind: 'output', outputId: 'result' },
    ],
    edges: [
      { id: 'entry', from: '$entry', to: 'extract' },
      { id: 'result', from: 'extract', to: 'out' },
    ],
  }
}
async function settled(store: Store, id: string) {
  const deadline = Date.now() + 15_000
  while (['queued', 'running'].includes(store.getRun(id)!.status)) {
    if (Date.now() > deadline) throw new Error('Run did not settle')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return store.getRun(id)!
}

test('builtin compiler validates configuration, pins tool identity, protects catalog and retains old hashes', () => {
  const flow = draft(process.cwd())
  const plan = compileFlow(flow, catalog)
  assert.equal((plan.nodes[0] as any).executor, undefined)
  assert.equal(plan.nodes[0].programHash, builtin.programHash)
  assert.throws(() => compileCF(builtin.draft), /不可修改/)
  const incomplete = structuredClone(flow)
  delete (incomplete.nodes[0] as any).toolInput
  assert.throws(() => compileFlow(incomplete, catalog), /文件/)
  const invalid = structuredClone(flow)
  ;(invalid.nodes[0] as any).toolInput = {
    source: { kind: 'upstream', nodeId: 'out', pointer: '/files' },
  }
  assert.throws(() => compileFlow(invalid, catalog), /直接上游/)
  const changed = structuredClone(flow)
  ;(changed.nodes[0] as any).toolInput.maxChars = 5
  assert.notEqual(compileFlow(changed, catalog).planHash, plan.planHash)
  const old = compileCF({ cfId: 'old', revision: 1, name: 'old', does: 'old' })
  assert.deepEqual(old.program, { version: '0.2', cfId: 'old', sourceRevision: 1, task: 'old' })
  assert.equal(
    old.programHash,
    sha256({
      inputContract: { type: 'object' },
      outputContract: { type: 'object' },
      program: old.program,
    }),
  )
})

test('runs with no registered executors, propagates results, and retains all-failure evidence', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cflow-builtin-engine-'))
  const store = new Store(join(root, 'test.sqlite'))
  t.after(async () => {
    store.close()
    await rm(root, { recursive: true, force: true })
  })
  await writeFile(join(root, 'document.txt'), '本地正文')
  const flow = draft(root)
  const plan = compileFlow(flow, catalog)
  const engine = new Engine(store, new ExecutorRegistry(), () => [builtin])
  store.createRun('one', 'test', {})
  engine.start('one', plan)
  assert.equal((await settled(store, 'one')).status, 'completed')
  assert.equal(
    ((store.getRun('one')!.value as any).value as FileExtractionResult).documents[0].text,
    '本地正文',
  )
  assert.deepEqual(store.agentInvocationsForRun('one'), [])
  assert.ok(store.events('one').some((event) => event.type === 'tool.file.completed'))
  await rm(join(root, 'document.txt'))
  store.createRun('two', 'test', {})
  engine.start('two', plan)
  assert.equal((await settled(store, 'two')).status, 'failed')
  assert.ok(
    store
      .events('two')
      .some((event) => event.type === 'tool.result' && (event.data as any).value.failed === 1),
  )
})

test('a builtin can consume a specific upstream path field and pass extracted text to an agent', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cflow-builtin-mixed-'))
  const store = new Store(join(root, 'test.sqlite'))
  t.after(async () => {
    store.close()
    await rm(root, { recursive: true, force: true })
  })
  await writeFile(join(root, 'document.txt'), '提取后交给后续步骤')
  const agent = compileCF({
    cfId: 'agent',
    name: '后续处理',
    revision: 1,
    does: '处理结果',
    defaultExecutor: 'spy',
  })
  const versions = [builtin, agent]
  let called = 0
  const registry = new ExecutorRegistry().register({
    id: 'spy',
    execute: async (_task, input) => {
      called++
      const context = input as any
      if (!context.upstream.length) return { files: ['document.txt'] }
      assert.equal(context.upstream[0].output.documents[0].text, '提取后交给后续步骤')
      return { accepted: true }
    },
  })
  const flow = draft(root)
  flow.nodes = [
    { id: 'paths', kind: 'cf-call', cfRef: { cfId: agent.cfId, version: agent.version } },
    {
      ...(flow.nodes[0] as any),
      toolInput: { source: { kind: 'upstream', nodeId: 'paths', pointer: '/files' } },
    },
    { id: 'consumer', kind: 'cf-call', cfRef: { cfId: agent.cfId, version: agent.version } },
    flow.nodes[1],
  ]
  flow.edges = [
    { id: 'a', from: '$entry', to: 'paths' },
    { id: 'b', from: 'paths', to: 'extract' },
    { id: 'c', from: 'extract', to: 'consumer' },
    { id: 'd', from: 'consumer', to: 'out' },
  ]
  const plan = compileFlow(
    flow,
    new Map(versions.map((item) => [`${item.cfId}@${item.version}`, item])),
  )
  store.createRun('mixed', 'test', {})
  new Engine(store, registry, () => versions).start('mixed', plan)
  assert.equal((await settled(store, 'mixed')).status, 'completed')
  assert.equal(called, 2)
  assert.equal(store.agentInvocationsForRun('mixed').length, 2)
  assert.ok(store.agentInvocationsForRun('mixed').every((item) => item.node !== 1))
})

test('HTTP builtin catalog, preview, test, publish and restart work without an available agent', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cflow-builtin-http-'))
  const database = join(root, 'test.sqlite')
  let store = new Store(database)
  let app = createApp(store, root)
  t.after(async () => {
    await app.close()
    store.close()
    await rm(root, { recursive: true, force: true })
  })
  await writeFile(join(root, 'document.txt'), 'HTTP 提取正文')
  const response = await app.inject({ method: 'GET', url: '/api/cfs' })
  assert.equal(response.json()[0].cfId, builtin.cfId)
  for (const endpoint of ['/api/cfs', `/api/cf-drafts/${encodeURIComponent(builtin.cfId)}`]) {
    const denied = await app.inject({
      method: endpoint === '/api/cfs' ? 'POST' : 'PUT',
      url: endpoint,
      payload: builtin.draft,
    })
    assert.equal(denied.statusCode, 400)
  }
  const flow = draft(root)
  ;(flow.nodes[0] as any).toolInput = {
    source: { kind: 'flow-input', pointer: '/files' },
    maxChars: 6,
  }
  for (const endpoint of ['/api/flow-compilations', '/api/flow-tests']) {
    const res = await app.inject({
      method: 'POST',
      url: endpoint,
      payload: {
        flowDraft: flow,
        cfDrafts: [],
        runtimeId: 'not-installed',
        input: { files: ['document.txt', 'missing.txt'] },
      },
    })
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(res.json().plan.nodes[0].executorProfile, undefined)
    if (res.json().runId) {
      assert.equal((await settled(store, res.json().runId)).status, 'completed')
      assert.deepEqual(store.agentInvocationsForRun(res.json().runId), [])
    }
  }
  const published = await app.inject({ method: 'POST', url: '/api/flows', payload: flow })
  assert.equal(published.statusCode, 200, published.body)
  const snapshot = store.flowCompilations().find((item) => item.mode === 'test')!
  assert.deepEqual((snapshot.plan.nodes[0] as any).toolInput, (flow.nodes[0] as any).toolInput)
  await app.close()
  store.close()
  store = new Store(database)
  app = createApp(store, root)
  const rerun = await app.inject({
    method: 'POST',
    url: '/api/flow-tests',
    payload: { flowDraft: snapshot.flowDraft, cfDrafts: [], input: { files: 'document.txt' } },
  })
  assert.equal(rerun.statusCode, 200, rerun.body)
  assert.equal((await settled(store, rerun.json().runId)).status, 'completed')
  const run = await app.inject({
    method: 'POST',
    url: '/api/runs',
    payload: {
      flowId: flow.flowId,
      flowVersion: published.json().flowVersion,
      input: { files: ['document.txt'] },
    },
  })
  assert.equal((await settled(store, run.json().runId)).status, 'completed')
  assert.equal(store.agentInvocationsForRun(run.json().runId).length, 0)
})

test('assistant catalog includes builtins and revisions preserve node configuration', () => {
  const flow = draft(process.cwd())
  const context = flowAgentContext(
    { message: '加入文件解析', flowDraft: flow },
    [],
    [builtin],
  ) as any
  assert.equal(context.catalog[0].execution.kind, 'builtin')
  const graph = buildProposalGraph(
    [{ name: builtin.draft.name, does: builtin.draft.does, cfId: builtin.cfId }],
    { catalog: [builtin], runtimeId: 'unused' },
  )
  assert.equal((graph.nodes[0] as any).executor, undefined)
  const revised = applyFlowRevision(
    flow,
    [],
    [{ kind: 'cf-call', name: builtin.draft.name, does: builtin.draft.does, cfId: builtin.cfId }],
    { catalog: [builtin], runtimeId: 'unused' },
  )
  assert.deepEqual((revised.flowDraft.nodes[0] as any).toolInput, (flow.nodes[0] as any).toolInput)
})

test('large parsing leaves HTTP responsive and cancellation prevents subsequent file dispatch', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cflow-responsive-'))
  const store = new Store(join(root, 'test.sqlite'))
  const app = createApp(store, root)
  t.after(async () => {
    await app.close()
    store.close()
    await rm(root, { recursive: true, force: true })
  })
  await writeFile(join(root, 'document.txt'), Buffer.alloc(20 * 1024 * 1024, 'a'))
  await writeFile(join(root, 'later.txt'), 'later')
  const flow = draft(root)
  ;(flow.nodes[0] as any).toolInput.source.paths.push('later.txt')
  const start = await app.inject({
    method: 'POST',
    url: '/api/flow-tests',
    payload: { flowDraft: flow },
  })
  assert.equal(start.statusCode, 200, start.body)
  const runId = start.json().runId
  const before = Date.now()
  const workspace = await app.inject({ method: 'GET', url: '/api/workspace' })
  assert.equal(workspace.statusCode, 200)
  assert.ok(Date.now() - before < 1000)
  assert.equal(store.getRun(runId)!.status, 'running')
  const cancelled = await app.inject({ method: 'POST', url: `/api/runs/${runId}/cancel` })
  assert.equal(cancelled.statusCode, 200)
  assert.equal((await settled(store, runId)).status, 'cancelled')
  assert.ok(
    !store
      .events(runId)
      .some(
        (event) => event.type === 'tool.file.started' && (event.data as any).path === 'later.txt',
      ),
  )
})

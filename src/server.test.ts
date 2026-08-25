import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApp } from './server.js'
import { Store } from './db.js'

test('HTTP API publishes and runs a Flow', async () => {
  const store = new Store(`/tmp/cf-api-${randomUUID()}.sqlite`)
  const app = createApp(store)
  await app.ready()
  const cf = {
    cfId: 'api-echo',
    revision: 1,
    name: 'Echo',
    does: 'echo',
    inputContract: { type: 'object' },
    outputContract: { type: 'object' },
    defaultExecutor: 'echo',
    program: {
      version: '0.1',
      cfId: 'api-echo',
      sourceRevision: 1,
      entry: 0,
      steps: [
        { index: 0, kind: 'agent', task: 'echo', input: '$input', next: 1 },
        { index: 1, kind: 'return', source: '$local.0.output' },
      ],
      limits: { maxStepExecutions: 4, maxExternalCalls: 1, maxOutputBytes: 4096 },
    },
  }
  const cfResponse = await app.inject({ method: 'POST', url: '/api/cfs', payload: cf })
  assert.equal(cfResponse.statusCode, 200)
  const version = cfResponse.json()
  const proposalResponse = await app.inject({
    method: 'POST',
    url: '/api/flow-proposals',
    payload: { objective: 'Echo' },
  })
  assert.equal(proposalResponse.statusCode, 200)
  assert.equal(proposalResponse.json().flowDraft.nodes.length, 2)
  assert.deepEqual(
    proposalResponse.json().flowDraft.bindings.map((binding: any) => binding.id),
    ['initial-input', 'result'],
  )
  const unmatchedProposal = await app.inject({
    method: 'POST',
    url: '/api/flow-proposals',
    payload: { objective: 'unrelated objective' },
  })
  assert.equal(unmatchedProposal.statusCode, 200)
  assert.equal(unmatchedProposal.json().flowDraft, null)
  const flow = {
    flowId: 'api-flow',
    revision: 1,
    name: 'API',
    objective: 'echo',
    nodes: [
      { id: 'call', kind: 'cf-call', cfRef: { cfId: 'api-echo', version: version.version } },
      { id: 'out', kind: 'output', outputId: 'result' },
    ],
    edges: [
      { id: 'start', from: '$entry', to: 'call' },
      { id: 'finish', from: 'call', to: 'out' },
    ],
    bindings: [
      { id: 'input', from: '$user.input.message', to: 'call.input.message' },
      { id: 'output', from: 'call.output', to: 'out.input' },
    ],
  }
  const flowResponse = await app.inject({ method: 'POST', url: '/api/flows', payload: flow })
  assert.equal(flowResponse.statusCode, 200)
  const plan = flowResponse.json()
  const runResponse = await app.inject({
    method: 'POST',
    url: '/api/runs',
    payload: { flowId: plan.flowId, flowVersion: plan.flowVersion, input: { message: 'api' } },
  })
  assert.equal(runResponse.statusCode, 200)
  const runId = runResponse.json().runId
  for (let i = 0; i < 100; i++) {
    const current = store.getRun(runId)
    if (current?.status === 'completed' || current?.status === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(store.getRun(runId)?.status, 'completed')
  await app.close()
  store.close()
})

test('tests Flow and candidate CF drafts without publishing either version', async () => {
  const store = new Store(`/tmp/cf-flow-test-${randomUUID()}.sqlite`)
  const app = createApp(store)
  await app.ready()
  const cfDraft = {
    cfId: 'candidate-echo',
    revision: 1,
    name: 'Candidate Echo',
    does: 'echo candidate input',
    defaultExecutor: 'echo',
  }
  const flowDraft = {
    flowId: 'candidate-flow',
    revision: 1,
    name: 'Candidate Flow',
    objective: 'test an unpublished flow',
    nodes: [
      {
        id: 'candidate',
        kind: 'cf-call' as const,
        cfRef: { cfId: 'candidate-echo', version: '1.0.0' },
      },
      { id: 'output', kind: 'output' as const, outputId: 'result' },
    ],
    edges: [
      { id: 'entry', from: '$entry' as const, to: 'candidate' },
      { id: 'finish', from: 'candidate', to: 'output' },
    ],
    bindings: [{ id: 'result', from: 'candidate.output', to: 'output.input' }],
  }
  const response = await app.inject({
    method: 'POST',
    url: '/api/flow-tests',
    payload: { flowDraft, cfDrafts: [cfDraft], input: { message: 'test' } },
  })
  assert.equal(response.statusCode, 200)
  const { runId, test: isTest } = response.json()
  assert.equal(isTest, true)
  for (let i = 0; i < 100; i++) {
    if (store.getRun(runId)?.status === 'completed') break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(store.getRun(runId)?.status, 'completed')
  assert.equal(store.list('cf_versions').length, 0)
  assert.equal(store.list('flow_versions').length, 0)
  await app.close()
  store.close()
})

test('approval API rejects non-approval nodes and runs in the wrong state', async () => {
  const store = new Store(`/tmp/cf-approval-api-${randomUUID()}.sqlite`)
  const app = createApp(store)
  await app.ready()
  const plan = {
    version: '0.4' as const,
    flowId: 'approval-flow',
    flowVersion: '1.0.0',
    objective: 'approval',
    entries: [0],
    nodes: [
      { index: 0, id: 'approval', kind: 'approval' as const, policyRef: 'manual' },
      { index: 1, id: 'output', kind: 'output' as const, outputId: 'result' },
    ],
    edges: [],
    bindings: [],
    limits: { maxConcurrency: 1, maxNodeDispatches: 4 },
    planHash: 'test',
  }
  store.save('flow_versions', 'approval-flow@1.0.0', plan)
  store.createRun('wrong-node', 'approval-flow@1.0.0')
  const wrongNodeJob = store.claimJob()
  if (wrongNodeJob) store.finishJob(wrongNodeJob.id)
  store.setRun('wrong-node', 'waiting-approval')
  const wrongNode = await app.inject({
    method: 'POST',
    url: '/api/runs/wrong-node/approvals/1',
    payload: { decision: 'approved' },
  })
  assert.equal(wrongNode.statusCode, 400)
  store.createRun('wrong-state', 'approval-flow@1.0.0')
  const wrongStateJob = store.claimJob()
  if (wrongStateJob) store.finishJob(wrongStateJob.id)
  const wrongState = await app.inject({
    method: 'POST',
    url: '/api/runs/wrong-state/approvals/0',
    payload: { decision: 'approved' },
  })
  assert.equal(wrongState.statusCode, 409)
  await app.close()
  store.close()
})

test('resolves required resource bindings into a Run and Ledger', async () => {
  const store = new Store(`/tmp/cf-resource-api-${randomUUID()}.sqlite`)
  const app = createApp(store)
  await app.ready()
  const cfResponse = await app.inject({
    method: 'POST',
    url: '/api/cfs',
    payload: {
      cfId: 'resource-echo',
      revision: 1,
      name: 'Resource Echo',
      does: 'echo',
      defaultExecutor: 'echo',
    },
  })
  const cf = cfResponse.json()
  const flowResponse = await app.inject({
    method: 'POST',
    url: '/api/flows',
    payload: {
      flowId: 'resource-flow',
      revision: 1,
      name: 'Resource Flow',
      objective: 'resource',
      nodes: [
        { id: 'call', kind: 'cf-call', cfRef: { cfId: cf.cfId, version: cf.version } },
        { id: 'output', kind: 'output', outputId: 'result' },
      ],
      edges: [
        { id: 'entry', from: '$entry', to: 'call' },
        { id: 'finish', from: 'call', to: 'output' },
      ],
      bindings: [],
      resources: [{ id: 'repo', type: 'repository', access: 'read', required: true }],
    },
  })
  const flow = flowResponse.json()
  const missingProfile = await app.inject({
    method: 'POST',
    url: '/api/runs',
    payload: { flowId: flow.flowId, flowVersion: flow.flowVersion },
  })
  assert.equal(missingProfile.statusCode, 400)
  const profileResponse = await app.inject({
    method: 'POST',
    url: '/api/resources',
    payload: {
      id: 'local-resources',
      name: 'Local resources',
      bindings: [{ requirementId: 'repo', resourceId: '/tmp/repo', type: 'repository' }],
    },
  })
  assert.equal(profileResponse.statusCode, 200)
  const runResponse = await app.inject({
    method: 'POST',
    url: '/api/runs',
    payload: {
      flowId: flow.flowId,
      flowVersion: flow.flowVersion,
      resourceProfileId: 'local-resources',
      input: { message: 'resource' },
    },
  })
  assert.equal(runResponse.statusCode, 200)
  const runId = runResponse.json().runId
  for (let i = 0; i < 100; i++) {
    if (store.getRun(runId)?.status === 'completed') break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(store.getRun(runId)?.resources[0].resourceId, '/tmp/repo')
  assert.ok(store.events(runId).some((event) => event.type === 'resources.bound'))
  assert.ok(store.events(runId).some((event) => event.type === 'resource.access'))
  await app.close()
  store.close()
})

test('persists workspace settings and immutable Runtime Profile versions', async () => {
  const store = new Store(`/tmp/cf-runtime-settings-${randomUUID()}.sqlite`)
  const app = createApp(store)
  await app.ready()
  const initial = await app.inject({ method: 'GET', url: '/api/runtimes' })
  assert.equal(initial.statusCode, 200)
  assert.ok(initial.json().some((runtime: any) => runtime.id === 'codex'))
  const create = await app.inject({
    method: 'POST',
    url: '/api/runtimes',
    payload: {
      id: 'test-process',
      name: 'Test Process',
      backend: 'process',
      command: process.execPath,
      args: [
        '-e',
        "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({runtime:'custom-ok'})))",
      ],
      versionArgs: ['--version'],
      promptTransport: 'stdin',
      outputMode: 'json',
      timeoutMs: 5000,
      maxOutputBytes: 65536,
      envAllowlist: ['PATH'],
      capabilities: ['test'],
      enabled: true,
    },
  })
  assert.equal(create.statusCode, 200)
  const created = create.json() as any
  assert.equal(created.profileVersion, 1)
  assert.equal(created.health.status, 'available')
  const update = await app.inject({
    method: 'POST',
    url: '/api/runtimes',
    payload: { ...created, name: 'Test Process v2', description: 'new profile' },
  })
  assert.equal(update.statusCode, 200)
  assert.equal(update.json().profileVersion, 2)
  const detail = await app.inject({ method: 'GET', url: '/api/runtimes/test-process' })
  assert.equal(detail.json().history.length, 2)
  const settings = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    payload: {
      defaultRuntimeId: 'test-process',
      workspaceRoot: process.cwd(),
      autoSaveDrafts: false,
      testTimeoutMs: 120000,
      locale: 'zh-CN',
    },
  })
  assert.equal(settings.statusCode, 200)
  assert.equal(settings.json().defaultRuntimeId, 'test-process')
  assert.equal(settings.json().autoSaveDrafts, false)
  await app.close()
  store.close()
})

test('executes a Flow through a configured process Runtime', async () => {
  const store = new Store(`/tmp/cf-process-runtime-${randomUUID()}.sqlite`)
  const app = createApp(store)
  await app.ready()
  const runtime = await app.inject({
    method: 'POST',
    url: '/api/runtimes',
    payload: {
      id: 'process-agent',
      name: 'Process Agent',
      backend: 'process',
      command: process.execPath,
      args: [
        '-e',
        "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({runtime:'process-agent',ok:true})))",
      ],
      versionArgs: ['--version'],
      outputMode: 'json',
      timeoutMs: 5000,
      maxOutputBytes: 65536,
      envAllowlist: ['PATH'],
      capabilities: ['test'],
      enabled: true,
    },
  })
  assert.equal(runtime.statusCode, 200)
  const cfResponse = await app.inject({
    method: 'POST',
    url: '/api/cfs',
    payload: {
      cfId: 'process-cf',
      revision: 1,
      name: 'Process CF',
      does: 'respond through the configured process runtime',
      defaultExecutor: 'process-agent',
      outputContract: {
        type: 'object',
        required: ['runtime', 'ok'],
        properties: { runtime: { const: 'process-agent' }, ok: { const: true } },
      },
    },
  })
  assert.equal(cfResponse.statusCode, 200)
  const cf = cfResponse.json()
  const flowResponse = await app.inject({
    method: 'POST',
    url: '/api/flows',
    payload: {
      flowId: 'process-flow',
      revision: 1,
      name: 'Process Flow',
      objective: 'verify runtime execution',
      nodes: [
        {
          id: 'call',
          kind: 'cf-call',
          cfRef: { cfId: cf.cfId, version: cf.version },
          executor: 'process-agent',
        },
        { id: 'output', kind: 'output', outputId: 'result' },
      ],
      edges: [
        { id: 'entry', from: '$entry', to: 'call' },
        { id: 'finish', from: 'call', to: 'output' },
      ],
      bindings: [{ id: 'result', from: 'call.output', to: 'output.input' }],
    },
  })
  const flow = flowResponse.json()
  assert.deepEqual(flow.nodes[0].executorProfile, { id: 'process-agent', profileVersion: 1 })
  const changedRuntime = await app.inject({
    method: 'POST',
    url: '/api/runtimes',
    payload: {
      ...(runtime.json() as any),
      name: 'Process Agent changed after publish',
      args: ['-e', "process.stdout.write('not-json')"],
    },
  })
  assert.equal(changedRuntime.statusCode, 200)
  assert.equal(changedRuntime.json().profileVersion, 2)
  const runResponse = await app.inject({
    method: 'POST',
    url: '/api/runs',
    payload: { flowId: flow.flowId, flowVersion: flow.flowVersion, input: {} },
  })
  const runId = runResponse.json().runId
  for (let i = 0; i < 200; i++) {
    if (['completed', 'failed'].includes(store.getRun(runId)?.status ?? '')) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const finalRun = store.getRun(runId)
  const startedEvent = store.events(runId).find((event) => event.type === 'node.started')
  await app.close()
  store.close()
  assert.equal(finalRun?.status, 'completed', JSON.stringify(finalRun))
  assert.deepEqual((finalRun?.value as any).value, {
    input: { runtime: 'process-agent', ok: true },
  })
  assert.deepEqual(
    (startedEvent?.data as any).executor,
    { id: 'process-agent', profileVersion: 1 },
  )
})

test('persists and removes Flow drafts through the workspace API', async () => {
  const store = new Store(`/tmp/cf-draft-api-${randomUUID()}.sqlite`)
  const app = createApp(store)
  await app.ready()
  const draft = {
    flowId: 'saved-draft',
    revision: 1,
    name: 'Saved Draft',
    objective: 'persist unfinished work',
    nodes: [{ id: 'output', kind: 'output', outputId: 'result' }],
    edges: [],
    bindings: [],
  }
  const save = await app.inject({
    method: 'PUT',
    url: '/api/flow-drafts/saved-draft',
    payload: draft,
  })
  assert.equal(save.statusCode, 200)
  const list = await app.inject({ method: 'GET', url: '/api/flow-drafts' })
  assert.equal(list.json()[0].flowId, 'saved-draft')
  const remove = await app.inject({ method: 'DELETE', url: '/api/flow-drafts/saved-draft' })
  assert.equal(remove.statusCode, 200)
  assert.equal(store.list('flow_drafts').length, 0)
  await app.close()
  store.close()
})

test('keeps every sequential Binding returned by a multi-stage Runtime proposal', async () => {
  const store = new Store(`/tmp/cf-proposal-bindings-${randomUUID()}.sqlite`)
  const app = createApp(store)
  await app.ready()
  const runtime = await app.inject({
    method: 'POST',
    url: '/api/runtimes',
    payload: {
      id: 'proposal-agent',
      name: 'Proposal Agent',
      backend: 'process',
      command: process.execPath,
      args: [
        '-e',
        "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({flowName:'Three stages',summary:'ok',stages:[{name:'Collect',does:'collect facts'},{name:'Review',does:'review facts'},{name:'Report',does:'write report'}]})))",
      ],
      versionArgs: ['--version'],
      promptTransport: 'stdin',
      outputMode: 'json',
      timeoutMs: 5000,
      maxOutputBytes: 65536,
      envAllowlist: ['PATH'],
      capabilities: ['reasoning'],
      enabled: true,
    },
  })
  assert.equal(runtime.statusCode, 200)
  const response = await app.inject({
    method: 'POST',
    url: '/api/flow-proposals',
    payload: { objective: 'collect, review, and report', runtimeId: 'proposal-agent' },
  })
  assert.equal(response.statusCode, 200)
  const proposal = response.json()
  assert.deepEqual(
    proposal.flowDraft.bindings.map((binding: any) => [binding.from, binding.to]),
    [
      ['$user.input', 'step-1.input'],
      ['step-1.output', 'step-2.input'],
      ['step-2.output', 'step-3.input'],
      ['step-3.output', 'output.input'],
    ],
  )
  await app.close()
  store.close()
})

test('fails closed when a JSON Runtime emits non-JSON output', async () => {
  const store = new Store(`/tmp/cf-invalid-json-${randomUUID()}.sqlite`)
  const app = createApp(store)
  await app.ready()
  const runtime = await app.inject({
    method: 'POST',
    url: '/api/runtimes',
    payload: {
      id: 'invalid-json-agent',
      name: 'Invalid JSON Agent',
      backend: 'process',
      command: process.execPath,
      args: ['-e', "process.stdout.write('definitely not JSON')"],
      versionArgs: ['--version'],
      promptTransport: 'stdin',
      outputMode: 'json',
      timeoutMs: 5000,
      maxOutputBytes: 65536,
      envAllowlist: ['PATH'],
      capabilities: ['test'],
      enabled: true,
    },
  })
  assert.equal(runtime.statusCode, 200)
  const cfResponse = await app.inject({
    method: 'POST',
    url: '/api/cfs',
    payload: {
      cfId: 'invalid-json-cf',
      revision: 1,
      name: 'Invalid JSON CF',
      does: 'return structured output',
      defaultExecutor: 'invalid-json-agent',
    },
  })
  const cf = cfResponse.json()
  const flowResponse = await app.inject({
    method: 'POST',
    url: '/api/flows',
    payload: {
      flowId: 'invalid-json-flow',
      revision: 1,
      name: 'Invalid JSON Flow',
      objective: 'fail closed',
      nodes: [
        { id: 'call', kind: 'cf-call', cfRef: { cfId: cf.cfId, version: cf.version } },
        { id: 'output', kind: 'output', outputId: 'result' },
      ],
      edges: [
        { id: 'entry', from: '$entry', to: 'call' },
        { id: 'finish', from: 'call', to: 'output' },
      ],
      bindings: [{ id: 'result', from: 'call.output', to: 'output.input' }],
    },
  })
  assert.equal(flowResponse.statusCode, 200)
  const flow = flowResponse.json()
  const runResponse = await app.inject({
    method: 'POST',
    url: '/api/runs',
    payload: { flowId: flow.flowId, flowVersion: flow.flowVersion, input: {} },
  })
  const runId = runResponse.json().runId
  for (let i = 0; i < 200; i++) {
    if (['completed', 'failed'].includes(store.getRun(runId)?.status ?? '')) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(store.getRun(runId)?.status, 'failed')
  assert.ok(
    store
      .events(runId)
      .some(
        (event) =>
          event.type === 'node.failed' &&
          String((event.data as any)?.error).includes('RUNTIME_JSON_INVALID'),
      ),
  )
  await app.close()
  store.close()
})

test('clears a deleted default Resource Profile and enforces workspace Runtime cwd scope', async () => {
  const store = new Store(`/tmp/cf-settings-safety-${randomUUID()}.sqlite`)
  const app = createApp(store)
  await app.ready()
  const resource = await app.inject({
    method: 'POST',
    url: '/api/resources',
    payload: { id: 'temporary', name: 'Temporary', bindings: [] },
  })
  assert.equal(resource.statusCode, 200)
  const settings = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    payload: { defaultResourceProfileId: 'temporary' },
  })
  assert.equal(settings.statusCode, 200)
  const removed = await app.inject({ method: 'DELETE', url: '/api/resources/temporary' })
  assert.equal(removed.statusCode, 200)
  const afterDelete = await app.inject({ method: 'GET', url: '/api/settings' })
  assert.equal(afterDelete.json().defaultResourceProfileId, undefined)
  const relativeRoot = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    payload: { workspaceRoot: '.' },
  })
  assert.equal(relativeRoot.statusCode, 400)
  assert.equal(relativeRoot.json().error, 'WORKSPACE_ROOT_INVALID')
  const outsideCwd = await app.inject({
    method: 'POST',
    url: '/api/runtimes',
    payload: {
      id: 'outside-cwd',
      name: 'Outside cwd',
      backend: 'process',
      command: process.execPath,
      args: ['-e', "process.stdout.write('{}')"],
      versionArgs: ['--version'],
      workingDirectory: '/tmp',
      promptTransport: 'stdin',
      outputMode: 'json',
      timeoutMs: 5000,
      maxOutputBytes: 65536,
      envAllowlist: ['PATH'],
      capabilities: [],
      enabled: true,
    },
  })
  assert.equal(outsideCwd.statusCode, 400)
  assert.equal(outsideCwd.json().error, 'RUNTIME_CWD_OUTSIDE_WORKSPACE')
  await app.close()
  store.close()
})

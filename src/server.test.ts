import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createApp, isDirectExecution } from './server.js'
import { Store } from './db.js'
import type { RuntimeProfile } from './types.js'

const createTestApp = (store: Store, workspaceRoot = process.cwd()) => {
  store.saveRuntimeProfile({
    id: 'echo',
    profileVersion: 1,
    name: 'Test executor',
    enabled: true,
    backend: 'builtin',
    args: [],
    versionArgs: [],
    promptTransport: 'stdin',
    outputMode: 'json',
    timeoutMs: 30_000,
    maxOutputBytes: 1_048_576,
    envAllowlist: [],
    capabilities: [],
    traits: {
      backendKind: 'builtin',
      sessionMode: 'stateless',
      structuredOutput: true,
      streaming: false,
      toolEvents: false,
      permissionPrompts: false,
      tokenAccounting: 'unavailable',
      cancellation: 'cooperative',
      filesystemIsolation: 'sandboxed',
      networkIsolation: 'enforced',
    },
    adapterBuild: 'test',
    createdAt: new Date(0).toISOString(),
  } satisfies RuntimeProfile)
  return createApp(store, workspaceRoot)
}

test('recognizes the npm bin symlink as direct execution', (t) => {
  const root = join('/tmp', `cflow-bin-${randomUUID()}`)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(root, { recursive: true })
  const bin = join(root, 'cflow')
  symlinkSync(fileURLToPath(new URL('./server.ts', import.meta.url)), bin)
  assert.equal(isDirectExecution(bin), true)
  assert.equal(isDirectExecution(join(root, 'missing')), false)
})

test('reports and enforces the launch workspace', async (t) => {
  const root = join('/tmp', `cflow-api-workspace-${randomUUID()}`)
  mkdirSync(root, { recursive: true })
  const store = new Store(join(root, 'api.sqlite'))
  const app = createTestApp(store, root)
  t.after(async () => {
    await app.close()
    store.close()
    rmSync(root, { recursive: true, force: true })
  })
  await app.ready()

  const workspace = await app.inject({ method: 'GET', url: '/api/workspace' })
  assert.equal(workspace.statusCode, 200)
  assert.deepEqual(workspace.json(), { root: realpathSync(root) })
  assert.equal((await app.inject({ method: 'GET', url: '/api/directories' })).statusCode, 404)

  const draft = {
    flowId: 'scoped-flow',
    revision: 1,
    name: 'Scoped Flow',
    objective: 'stay in the launch workspace',
    workspaceRoot: '/tmp',
    nodes: [{ id: 'output', kind: 'output', outputId: 'result' }],
    edges: [],
  }
  const cfDraft = {
    cfId: 'empty-step',
    revision: 1,
    name: '',
    does: '',
    fileReferences: ['notes/input.md'],
  }
  const saved = await app.inject({
    method: 'PUT',
    url: '/api/flow-drafts/scoped-flow',
    payload: { flowDraft: draft, cfDrafts: [cfDraft] },
  })
  assert.equal(saved.statusCode, 200)
  assert.equal(saved.json().flowDraft.workspaceRoot, realpathSync(root))
  assert.deepEqual(saved.json().cfDrafts, [cfDraft])
  assert.equal(store.get<any>('flow_drafts', draft.flowId)?.workspaceRoot, realpathSync(root))
  assert.deepEqual(store.get<any>('cf_drafts', cfDraft.cfId), cfDraft)
})

test('searches workspace file paths without reading contents or following excluded paths', async (t) => {
  const root = join('/tmp', `cflow-file-index-${randomUUID()}`)
  mkdirSync(join(root, 'reports'), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'hidden'), { recursive: true })
  writeFileSync(join(root, 'reports', 'report.csv'), 'PRIVATE_FILE_CONTENT')
  writeFileSync(join(root, 'reports', 'summary.md'), '# Summary')
  writeFileSync(join(root, 'node_modules', 'hidden', 'package.js'), 'excluded')
  symlinkSync(join(root, 'reports'), join(root, 'linked-reports'))
  const store = new Store(join(root, 'api.sqlite'))
  const app = createTestApp(store, root)
  t.after(async () => {
    await app.close()
    store.close()
    rmSync(root, { recursive: true, force: true })
  })
  await app.ready()

  const response = await app.inject({
    method: 'POST',
    url: '/api/workspace/files/search',
    payload: {
      query: 'report.csv',
      selected: ['reports/report.csv', 'reports/missing.csv', '../outside.txt'],
    },
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json().matches, ['reports/report.csv'])
  assert.deepEqual(response.json().missing, ['reports/missing.csv'])
  assert.equal(response.json().truncated, false)
  assert.doesNotMatch(response.body, /PRIVATE_FILE_CONTENT/)
  assert.doesNotMatch(response.body, /linked-reports|node_modules|outside/)
})

test('HTTP API publishes and runs a Flow', async () => {
  const store = new Store(`/tmp/cf-api-${randomUUID()}.sqlite`)
  const app = createTestApp(store)
  await app.ready()
  const cf = {
    cfId: 'api-echo',
    revision: 1,
    name: 'Echo',
    does: 'echo',
    inputContract: { type: 'object' },
    outputContract: { type: 'object' },
    defaultExecutor: 'echo',
  }
  const cfResponse = await app.inject({ method: 'POST', url: '/api/cfs', payload: cf })
  assert.equal(cfResponse.statusCode, 200)
  const version = cfResponse.json()
  const proposalResponse = await app.inject({
    method: 'POST',
    url: '/api/flow-proposals',
    payload: { objective: 'Echo', workspaceRoot: process.cwd() },
  })
  assert.equal(proposalResponse.statusCode, 200)
  assert.equal(proposalResponse.json().flowDraft.nodes.length, 2)
  assert.deepEqual(
    proposalResponse.json().flowDraft.nodes.map((node: { kind: string }) => node.kind),
    ['cf-call', 'output'],
  )
  const unmatchedProposal = await app.inject({
    method: 'POST',
    url: '/api/flow-proposals',
    payload: { objective: 'unrelated objective', workspaceRoot: process.cwd() },
  })
  assert.equal(unmatchedProposal.statusCode, 200)
  assert.equal(unmatchedProposal.json().flowDraft, null)
  const flow = {
    flowId: 'api-flow',
    revision: 1,
    name: 'API',
    objective: 'echo',
    workspaceRoot: process.cwd(),
    nodes: [
      { id: 'call', kind: 'cf-call', cfRef: { cfId: 'api-echo', version: version.version } },
      { id: 'out', kind: 'output', outputId: 'result' },
    ],
    edges: [
      { id: 'start', from: '$entry', to: 'call' },
      { id: 'finish', from: 'call', to: 'out' },
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
  const detailResponse = await app.inject({ method: 'GET', url: `/api/runs/${runId}` })
  assert.equal(detailResponse.statusCode, 200)
  assert.equal(detailResponse.json().run.id, runId)
  assert.ok(Array.isArray(detailResponse.json().events))
  await app.close()
  store.close()
})

test('requires an ACP runtime for skill attachment analysis', async () => {
  const store = new Store(`/tmp/cf-skill-upload-${randomUUID()}.sqlite`)
  const app = createTestApp(store)
  await app.ready()
  const boundary = 'cflow-boundary'
  const payload = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="objective"',
    '',
    'convert this skill into a flow',
    `--${boundary}`,
    'Content-Disposition: form-data; name="runtimeId"',
    '',
    'echo',
    `--${boundary}`,
    'Content-Disposition: form-data; name="attachments"; filename="SKILL.md"',
    'Content-Type: text/markdown',
    '',
    '# Skill\n1. Read input\n2. Return result',
    `--${boundary}--`,
    '',
  ].join('\r\n')
  const response = await app.inject({
    method: 'POST',
    url: '/api/flow-proposals',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  })
  assert.equal(response.statusCode, 400)
  assert.equal(response.json().error, 'RUNTIME_ANALYSIS_REQUIRED')
  await app.close()
  store.close()
})

test('passes uploaded text content to the runtime instead of only attachment filenames', async (t) => {
  const root = join('/tmp', `cf-skill-content-${randomUUID()}`)
  // Cleanup runs on assertion failure too: an unclosed fastify app / sqlite
  // handle would otherwise keep the test process alive and hang the suite.
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(root, { recursive: true })
  const executable = join(root, 'content-runtime')
  writeFileSync(
    executable,
    `#!/usr/bin/env node
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => input += chunk)
process.stdin.on('end', () => {
  const found = input.includes('UNIQUE_SKILL_MARKER')
  const ungrounded = input.includes('NO_GROUNDING')
  process.stdout.write(JSON.stringify({
    flowName: found ? 'marker-flow' : 'wrong-flow',
    summary: found ? 'source used' : 'source missing',
    stages: [{ kind: 'cf-call', name: found ? 'marker-stage' : 'wrong-stage', does: found ? 'use UNIQUE_SKILL_MARKER' : 'ignore source', input: '', output: '', process: '', sourceQuote: ungrounded ? 'invented quote that appears nowhere in the source' : (found ? 'Use UNIQUE_SKILL_MARKER as the source step.' : 'ignore source entirely') }]
  }))
})
`,
  )
  chmodSync(executable, 0o755)
  const store = new Store(join(root, 'runtime.sqlite'))
  store.saveRuntimeProfile({
    id: 'content-runtime',
    profileVersion: 1,
    name: 'Content runtime',
    enabled: true,
    backend: 'cli',
    command: executable,
    args: [],
    versionArgs: [],
    promptTransport: 'stdin',
    outputMode: 'json',
    timeoutMs: 30_000,
    maxOutputBytes: 1_048_576,
    envAllowlist: ['PATH'],
    capabilities: ['workspace-read'],
    traits: {
      backendKind: 'process',
      sessionMode: 'stateless',
      structuredOutput: true,
      streaming: false,
      toolEvents: false,
      permissionPrompts: false,
      tokenAccounting: 'unavailable',
      cancellation: 'process-kill',
      filesystemIsolation: 'host-permissions',
      networkIsolation: 'unenforced',
    },
    adapterBuild: 'test',
    createdAt: new Date(0).toISOString(),
  } satisfies RuntimeProfile)
  const app = createApp(store, root)
  await app.ready()
  t.after(() => app.close())
  t.after(() => store.close())
  const boundary = 'cflow-content-boundary'
  const payload = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="objective"',
    '',
    'turn this skill into a flow',
    `--${boundary}`,
    'Content-Disposition: form-data; name="runtimeId"',
    '',
    'content-runtime',
    `--${boundary}`,
    'Content-Disposition: form-data; name="attachments"; filename="SKILL.md"',
    'Content-Type: text/markdown',
    '',
    '# Skill\nUse UNIQUE_SKILL_MARKER as the source step.',
    `--${boundary}--`,
    '',
  ].join('\r\n')
  const response = await app.inject({
    method: 'POST',
    url: '/api/flow-proposals',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  })
  assert.equal(response.statusCode, 200, JSON.stringify(response.json()))
  assert.equal(response.json().flowDraft.name, 'marker-flow')
  assert.equal(response.json().cfDrafts[0].name, 'marker-stage')
  assert.equal(store.get<any>('cf_drafts', response.json().cfDrafts[0].cfId)?.name, 'marker-stage')
  const ungroundedPayload = payload.replace('UNIQUE_SKILL_MARKER', 'NO_GROUNDING')
  const ungroundedResponse = await app.inject({
    method: 'POST',
    url: '/api/flow-proposals',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: ungroundedPayload,
  })
  assert.equal(ungroundedResponse.statusCode, 400)
  assert.equal(ungroundedResponse.json().error, 'RUNTIME_PROPOSAL_UNGROUNDED:1')
})

test('tests Flow and candidate CF drafts without publishing either version', async () => {
  const store = new Store(`/tmp/cf-flow-test-${randomUUID()}.sqlite`)
  const app = createTestApp(store)
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
    workspaceRoot: process.cwd(),
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
  }
  const response = await app.inject({
    method: 'POST',
    url: '/api/flow-tests',
    payload: { flowDraft, cfDrafts: [cfDraft], input: { message: 'test' } },
  })
  assert.equal(response.statusCode, 200)
  const { runId, test: isTest, plan, programs } = response.json()
  assert.equal(isTest, true)
  assert.equal(plan.flowId, 'candidate-flow')
  assert.equal(programs.length, 1)
  for (let i = 0; i < 100; i++) {
    if (store.getRun(runId)?.status === 'completed') break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(store.getRun(runId)?.status, 'completed')
  const repeated = await app.inject({
    method: 'POST',
    url: '/api/flow-tests',
    payload: { flowDraft, cfDrafts: [cfDraft], input: { message: 'test again' } },
  })
  assert.equal(repeated.statusCode, 200)
  assert.notEqual(repeated.json().runId, runId)
  assert.equal(store.flowCompilations().length, 2)
  assert.equal(store.list('cf_versions').length, 0)
  assert.equal(store.list('flow_versions').length, 0)
  await app.close()
  store.close()
})

test('previews complete compiler output without publishing or running', async () => {
  const store = new Store(`/tmp/cf-flow-preview-${randomUUID()}.sqlite`)
  const app = createTestApp(store)
  await app.ready()
  const cfDraft = {
    cfId: 'preview-cf',
    revision: 1,
    name: 'Preview capability',
    does: 'prepare @{reports/not-indexed.csv}',
    effects: [
      { type: 'file-read' as const, scope: 'workspace' as const, description: 'read files' },
    ],
    fileReferences: ['reports/missing.csv'],
    defaultExecutor: 'echo',
  }
  const flowDraft = {
    flowId: 'preview-flow',
    revision: 3,
    name: 'Compiler Preview',
    objective: 'inspect the whole compiled result',
    workspaceRoot: process.cwd(),
    nodes: [
      {
        id: 'prepare',
        kind: 'cf-call' as const,
        cfRef: { cfId: 'preview-cf', version: '1.0.0' },
      },
      { id: 'output', kind: 'output' as const, outputId: 'result' },
    ],
    edges: [
      { id: 'entry', from: '$entry' as const, to: 'prepare' },
      { id: 'finish', from: 'prepare', to: 'output' },
    ],
  }
  const response = await app.inject({
    method: 'POST',
    url: '/api/flow-compilations',
    payload: { flowDraft, cfDrafts: [cfDraft] },
  })
  assert.equal(response.statusCode, 200)
  const preview = response.json()
  assert.equal(preview.plan.flowId, 'preview-flow')
  assert.equal(preview.plan.nodes[0].programHash, preview.programs[0].programHash)
  assert.equal(preview.programs[0].program.cfId, 'preview-cf')
  assert.equal(preview.programs.length, 1)
  assert.deepEqual(
    preview.warnings.map((warning: { code: string }) => warning.code),
    ['INDEXED_FILE_MISSING', 'FILE_MENTION_NOT_INDEXED'],
  )
  assert.equal(store.flowCompilations().length, 1)
  const repeated = await app.inject({
    method: 'POST',
    url: '/api/flow-compilations',
    payload: { flowDraft, cfDrafts: [cfDraft, cfDraft] },
  })
  assert.equal(repeated.json().programs.length, 1)
  assert.equal(store.list('cf_versions').length, 0)
  assert.equal(store.list('flow_versions').length, 0)
  assert.equal(store.runs().length, 0)
  await app.close()
  store.close()
})

test('resolves required resource bindings into a Run and Ledger', async () => {
  const store = new Store(`/tmp/cf-resource-api-${randomUUID()}.sqlite`)
  const app = createTestApp(store)
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
      workspaceRoot: process.cwd(),
      nodes: [
        { id: 'call', kind: 'cf-call', cfRef: { cfId: cf.cfId, version: cf.version } },
        { id: 'output', kind: 'output', outputId: 'result' },
      ],
      edges: [
        { id: 'entry', from: '$entry', to: 'call' },
        { id: 'finish', from: 'call', to: 'output' },
      ],
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
  const app = createTestApp(store)
  await app.ready()
  const initial = await app.inject({ method: 'GET', url: '/api/runtimes' })
  assert.equal(initial.statusCode, 200)
  assert.ok(initial.json().some((runtime: any) => runtime.id === 'codex'))
  assert.ok(initial.json().every((runtime: any) => runtime.id !== 'echo'))
  assert.ok(initial.json().every((runtime: any) => runtime.id !== 'cflow-demo'))
  const discovered = await app.inject({ method: 'POST', url: '/api/runtimes/discover' })
  assert.equal(discovered.statusCode, 200)
  assert.ok(Array.isArray(discovered.json().runtimes))
  assert.ok(Array.isArray(discovered.json().warnings))
  const create = await app.inject({
    method: 'POST',
    url: '/api/runtimes',
    payload: {
      id: 'echo',
      name: 'Test executor v2',
      backend: 'builtin',
      args: [],
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
  assert.equal(created.profileVersion, 2)
  assert.equal(created.health.status, 'available')
  const reserved = await app.inject({
    method: 'POST',
    url: '/api/runtimes',
    payload: {
      id: 'cflow-demo',
      name: 'External demo replacement',
      backend: 'cli',
      command: '/bin/false',
    },
  })
  assert.equal(reserved.statusCode, 400)
  assert.match(reserved.body, /RUNTIME_ID_RESERVED/)
  const update = await app.inject({
    method: 'POST',
    url: '/api/runtimes',
    payload: { ...created, name: 'Test executor v3', description: 'new profile' },
  })
  assert.equal(update.statusCode, 200)
  assert.equal(update.json().profileVersion, 3)
  const detail = await app.inject({ method: 'GET', url: '/api/runtimes/echo' })
  assert.equal(detail.json().history.length, 3)
  const settings = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    payload: {
      defaultRuntimeId: 'codex',
      autoSaveDrafts: false,
      testTimeoutMs: 120000,
      locale: 'zh-CN',
    },
  })
  assert.equal(settings.statusCode, 200)
  assert.equal(settings.json().defaultRuntimeId, 'codex')
  assert.equal(settings.json().autoSaveDrafts, false)
  await app.close()
  store.close()
})

test('executes a Flow through the builtin Runtime without process adapters', async () => {
  const store = new Store(`/tmp/cf-builtin-runtime-${randomUUID()}.sqlite`)
  const app = createTestApp(store)
  await app.ready()
  const cfResponse = await app.inject({
    method: 'POST',
    url: '/api/cfs',
    payload: {
      cfId: 'builtin-cf',
      revision: 1,
      name: 'Builtin CF',
      does: 'respond through the builtin runtime',
      defaultExecutor: 'echo',
      outputContract: {
        type: 'object',
        required: ['task', 'input'],
        properties: {
          task: { const: 'respond through the builtin runtime' },
          input: { type: 'object' },
        },
      },
    },
  })
  assert.equal(cfResponse.statusCode, 200)
  const cf = cfResponse.json()
  const flowResponse = await app.inject({
    method: 'POST',
    url: '/api/flows',
    payload: {
      flowId: 'builtin-flow',
      revision: 1,
      name: 'Builtin Flow',
      objective: 'verify runtime execution',
      workspaceRoot: process.cwd(),
      nodes: [
        {
          id: 'call',
          kind: 'cf-call',
          cfRef: { cfId: cf.cfId, version: cf.version },
          executor: 'echo',
        },
        { id: 'output', kind: 'output', outputId: 'result' },
      ],
      edges: [
        { id: 'entry', from: '$entry', to: 'call' },
        { id: 'finish', from: 'call', to: 'output' },
      ],
    },
  })
  const flow = flowResponse.json()
  assert.deepEqual(flow.nodes[0].executorProfile, { id: 'echo', profileVersion: 1 })
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
    task: 'respond through the builtin runtime',
    input: {
      flowInput: {},
      upstream: [],
    },
  })
  assert.deepEqual((startedEvent?.data as any).executor, { id: 'echo', profileVersion: 1 })
})

test('creates a Hello World demo draft and test-runs it without process adapters', async () => {
  const store = new Store(`/tmp/cf-demo-flow-${randomUUID()}.sqlite`)
  const app = createTestApp(store)
  await app.ready()
  const created = await app.inject({ method: 'POST', url: '/api/flow-drafts/demo' })
  assert.equal(created.statusCode, 200)
  const bundle = created.json() as { flowDraft: any; cfDrafts: any[] }
  assert.match(bundle.flowDraft.flowId, /^cflow-demo-/)
  assert.equal(bundle.flowDraft.name, '示例：写出 Hello World 页面')
  const kinds = new Set(bundle.flowDraft.nodes.map((node: { kind: string }) => node.kind))
  assert.ok(['cf-call', 'branch', 'join', 'output'].every((kind) => kinds.has(kind)))
  assert.ok(
    bundle.cfDrafts.every((cf: { defaultExecutor: string }) => cf.defaultExecutor === 'cflow-demo'),
  )

  const listed = await app.inject({ method: 'GET', url: '/api/flow-drafts' })
  assert.ok(
    listed.json().some((draft: { flowId: string }) => draft.flowId === bundle.flowDraft.flowId),
  )

  const testRun = await app.inject({
    method: 'POST',
    url: '/api/flow-tests',
    payload: { flowDraft: bundle.flowDraft, cfDrafts: bundle.cfDrafts, input: {} },
  })
  assert.equal(testRun.statusCode, 200, testRun.body)
  const runId = testRun.json().runId as string
  for (let i = 0; i < 200; i++) {
    if (['completed', 'failed'].includes(store.getRun(runId)?.status ?? '')) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const finalRun = store.getRun(runId)
  const events = store.events(runId)
  assert.equal(finalRun?.status, 'completed', JSON.stringify(finalRun))
  const output = (
    finalRun?.value as { outputId?: string; value?: { html?: string; title?: string } }
  )?.value
  assert.equal((finalRun?.value as { outputId?: string })?.outputId, 'result')
  assert.equal(output?.title, 'Hello World')
  assert.match(String(output?.html ?? ''), /Hello World/)
  assert.ok(events.some((event) => event.type === 'node.inactive'))
  assert.ok(
    events.some(
      (event) =>
        event.type === 'node.started' &&
        (event.data as { executor?: { id?: string } } | undefined)?.executor?.id === 'cflow-demo',
    ),
  )
  assert.ok(
    events.some(
      (event) =>
        event.type === 'node.completed' &&
        bundle.flowDraft.nodes[event.node ?? -1]?.kind === 'join',
    ),
  )

  const publishedCf = await app.inject({
    method: 'POST',
    url: '/api/cfs',
    payload: bundle.cfDrafts[0],
  })
  assert.equal(publishedCf.statusCode, 200)
  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/flow-drafts/${bundle.flowDraft.flowId}`,
  })
  assert.equal(removed.statusCode, 200)
  const remainingCfDrafts = (await app.inject({ method: 'GET', url: '/api/cf-drafts' })).json()
  assert.ok(
    remainingCfDrafts.some(
      (storedCf: { cfId: string }) => storedCf.cfId === bundle.cfDrafts[0].cfId,
    ),
  )
  assert.ok(
    bundle.cfDrafts
      .slice(1)
      .every(
        (demoCf: { cfId: string }) =>
          !remainingCfDrafts.some((storedCf: { cfId: string }) => storedCf.cfId === demoCf.cfId),
      ),
  )
  await app.close()
  store.close()
})

test('persists and removes Flow drafts through the workspace API', async () => {
  const store = new Store(`/tmp/cf-draft-api-${randomUUID()}.sqlite`)
  const app = createTestApp(store)
  await app.ready()
  const draft = {
    flowId: 'saved-draft',
    revision: 1,
    name: 'Saved Draft',
    objective: 'persist unfinished work',
    workspaceRoot: process.cwd(),
    nodes: [{ id: 'output', kind: 'output', outputId: 'result' }],
    edges: [],
  }
  const save = await app.inject({
    method: 'PUT',
    url: '/api/flow-drafts/saved-draft',
    payload: { flowDraft: draft, cfDrafts: [] },
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

test('removes a published Flow version through the workspace API', async () => {
  const store = new Store(`/tmp/cf-flow-version-delete-${randomUUID()}.sqlite`)
  const app = createTestApp(store)
  await app.ready()
  const plan = {
    version: '0.5' as const,
    flowId: 'published-flow',
    flowVersion: '2.0.0',
    objective: 'published flow',
    workspaceRoot: process.cwd(),
    entries: [0],
    nodes: [{ index: 0, id: 'output', kind: 'output' as const, outputId: 'result' }],
    edges: [],
    limits: { maxConcurrency: 1, maxNodeDispatches: 4 },
    planHash: 'test',
  }
  store.save('flow_versions', 'published-flow@2.0.0', plan)
  const remove = await app.inject({
    method: 'DELETE',
    url: '/api/flows/published-flow/2.0.0',
  })
  assert.equal(remove.statusCode, 200)
  assert.equal(store.list('flow_versions').length, 0)
  const list = await app.inject({ method: 'GET', url: '/api/flows' })
  assert.deepEqual(list.json(), [])
  const missing = await app.inject({ method: 'DELETE', url: '/api/flows/published-flow/2.0.0' })
  assert.equal(missing.statusCode, 404)
  await app.close()
  store.close()
})

test('keeps sequential stages returned by a multi-stage local proposal', async () => {
  const store = new Store(`/tmp/cf-proposal-stages-${randomUUID()}.sqlite`)
  const app = createTestApp(store)
  await app.ready()
  for (const [cfId, name, does] of [
    ['collect-cf', 'Collect', 'collect facts'],
    ['review-cf', 'Review', 'review facts'],
    ['report-cf', 'Report', 'report facts'],
  ]) {
    const cfResponse = await app.inject({
      method: 'POST',
      url: '/api/cfs',
      payload: { cfId, revision: 1, name, does, defaultExecutor: 'echo' },
    })
    assert.equal(cfResponse.statusCode, 200)
  }
  const response = await app.inject({
    method: 'POST',
    url: '/api/flow-proposals',
    payload: { objective: 'collect review report', workspaceRoot: process.cwd() },
  })
  assert.equal(response.statusCode, 200)
  const proposal = response.json()
  assert.deepEqual(
    proposal.flowDraft.nodes.map((node: { id: string; kind: string }) => [node.id, node.kind]),
    [
      ['step-1', 'cf-call'],
      ['step-2', 'cf-call'],
      ['step-3', 'cf-call'],
      ['output', 'output'],
    ],
  )
  assert.deepEqual(
    proposal.flowDraft.edges.map((edge: { from: string; to: string }) => [edge.from, edge.to]),
    [
      ['$entry', 'step-1'],
      ['step-1', 'step-2'],
      ['step-2', 'step-3'],
      ['step-3', 'output'],
    ],
  )
  await app.close()
  store.close()
})

test('rejects legacy process Runtime profiles', async () => {
  const store = new Store(`/tmp/cf-legacy-runtime-${randomUUID()}.sqlite`)
  const app = createTestApp(store)
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
  assert.equal(runtime.statusCode, 400)
  assert.equal(runtime.json().error, 'RUNTIME_BACKEND_INVALID')
  await app.close()
  store.close()
})

test('clears a deleted default Resource Profile and enforces workspace Runtime cwd scope', async () => {
  const store = new Store(`/tmp/cf-settings-safety-${randomUUID()}.sqlite`)
  const app = createTestApp(store)
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
  assert.equal(relativeRoot.json().error, 'WORKSPACE_ROOT_SETTING_REMOVED')
  const outsideCwd = await app.inject({
    method: 'POST',
    url: '/api/runtimes',
    payload: {
      id: 'outside-cwd',
      name: 'Outside cwd',
      backend: 'acp',
      command: 'codex-acp',
      args: [],
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
  assert.equal(outsideCwd.statusCode, 200)
  await app.close()
  store.close()
})

test('returns flow-aware fallback guidance without inventing a revision', async () => {
  const store = new Store(`/tmp/cf-agent-chat-${randomUUID()}.sqlite`)
  const app = createTestApp(store)
  await app.ready()
  const response = await app.inject({
    method: 'POST',
    url: '/api/flow-agent/chat',
    payload: {
      message: '请帮我解决最近的运行错误',
      runtimeId: 'echo',
      flowDraft: {
        flowId: 'agent-flow',
        revision: 2,
        name: 'Agent flow',
        objective: 'recover a failed flow',
        workspaceRoot: process.cwd(),
        nodes: [
          { id: 'fetch', kind: 'cf-call', cfRef: { cfId: 'fetch', version: '1.0.0' } },
          { id: 'output', kind: 'output', outputId: 'result' },
        ],
        edges: [{ id: 'entry', from: '$entry', to: 'fetch' }],
      },
      runDetail: {
        run: { status: 'failed', flow_version_id: 'test:run' },
        events: [{ type: 'node.failed', node: 0, data: { error: 'timeout' } }],
      },
    },
  })
  assert.equal(response.statusCode, 200)
  assert.match(response.json().message, /fetch/)
  assert.equal(response.json().fallback, true)
  assert.equal(response.json().intent, 'answer')
  assert.deepEqual(response.json().stages, [])
  assert.equal(response.json().actions, undefined)
  await app.close()
  store.close()
})

test('flow agent trusts the request snapshot, writes only revisions, and keeps the flow id', async (t) => {
  const root = join('/tmp', `cf-agent-revision-${randomUUID()}`)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(root, { recursive: true })
  const executable = join(root, 'revision-runtime')
  const capture = join(root, 'input.txt')
  writeFileSync(
    executable,
    `#!/usr/bin/env node
if (process.argv.includes('--version')) {
  process.stdout.write('revision-runtime 1.0')
  process.exit(0)
}
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => input += chunk)
process.stdin.on('end', () => {
  require('node:fs').writeFileSync(${JSON.stringify(capture)}, input)
  const answer = input.includes('QUESTION_ONLY')
  process.stdout.write(JSON.stringify(answer
    ? { message: '只回答当前稿', intent: 'answer', stages: [] }
    : {
        message: '已更新第二步',
        intent: 'revise',
        stages: [{
          kind: 'cf-call',
          name: '屏幕上的步骤',
          does: '使用屏幕稿中的职责',
          cfId: 'screen-cf',
          input: '当前输入',
          output: '当前输出',
          process: '按当前要求处理'
        }]
      }))
})
`,
  )
  chmodSync(executable, 0o755)
  const store = new Store(join(root, 'agent.sqlite'))
  store.saveRuntimeProfile({
    id: 'revision-runtime',
    profileVersion: 1,
    name: 'Revision runtime',
    enabled: true,
    backend: 'cli',
    command: executable,
    args: [],
    versionArgs: ['--version'],
    promptTransport: 'stdin',
    outputMode: 'json',
    timeoutMs: 30_000,
    maxOutputBytes: 1_048_576,
    envAllowlist: ['PATH'],
    capabilities: [],
    traits: {
      backendKind: 'process',
      sessionMode: 'stateless',
      structuredOutput: true,
      streaming: false,
      toolEvents: false,
      permissionPrompts: false,
      tokenAccounting: 'unavailable',
      cancellation: 'process-kill',
      filesystemIsolation: 'host-permissions',
      networkIsolation: 'unenforced',
    },
    adapterBuild: 'test',
    createdAt: new Date(0).toISOString(),
  } satisfies RuntimeProfile)
  const databaseDraft = {
    flowId: 'same-flow',
    revision: 1,
    name: 'database old',
    objective: 'database old objective',
    workspaceRoot: process.cwd(),
    nodes: [{ id: 'output', kind: 'output' as const, outputId: 'result' }],
    edges: [],
  }
  store.save('flow_drafts', databaseDraft.flowId, databaseDraft)
  const app = createApp(store)
  await app.ready()
  t.after(() => app.close())
  t.after(() => store.close())

  const candidate = {
    cfId: 'screen-cf',
    revision: 1,
    name: '屏幕上的步骤',
    does: '屏幕稿职责',
    input: '屏幕输入',
    output: '屏幕输出',
  }
  const screenDraft = {
    ...databaseDraft,
    revision: 8,
    name: 'screen answer draft',
    objective: 'screen objective',
    nodes: [
      {
        id: 'screen-step',
        kind: 'cf-call' as const,
        cfRef: { cfId: candidate.cfId, version: '1.0.0' },
        executor: 'revision-runtime',
      },
      { id: 'output', kind: 'output' as const, outputId: 'result' },
    ],
    edges: [
      { id: 'entry', from: '$entry' as const, to: 'screen-step' },
      { id: 'done', from: 'screen-step', to: 'output' },
    ],
  }
  const answer = await app.inject({
    method: 'POST',
    url: '/api/flow-agent/chat',
    payload: {
      message: 'QUESTION_ONLY 第二步做什么',
      runtimeId: 'revision-runtime',
      flowDraft: screenDraft,
      cfDrafts: [candidate],
    },
  })
  assert.equal(answer.statusCode, 200)
  assert.equal(answer.json().intent, 'answer')
  assert.equal(answer.json().flowDraft, undefined)
  assert.equal(store.get<any>('flow_drafts', 'same-flow').revision, 1)
  const answerInput = await import('node:fs/promises').then(({ readFile }) =>
    readFile(capture, 'utf8'),
  )
  assert.match(answerInput, /"revision":8/)
  assert.match(answerInput, /screen answer draft/)
  assert.doesNotMatch(answerInput, /database old objective/)

  const revise = await app.inject({
    method: 'POST',
    url: '/api/flow-agent/chat',
    payload: {
      message: '把第二步改成当前要求',
      runtimeId: 'revision-runtime',
      flowDraft: { ...screenDraft, revision: 5 },
      cfDrafts: [candidate],
      conversation: [
        { role: 'user', body: '上一轮要求' },
        { role: 'assistant', body: '上一轮结果' },
      ],
      selection: { nodeId: 'screen-step', edgeId: null },
      check: { error: 'LAST_CHECK_ERROR' },
    },
  })
  assert.equal(revise.statusCode, 200)
  assert.equal(revise.json().intent, 'revise')
  assert.equal(revise.json().flowDraft.flowId, 'same-flow')
  assert.equal(revise.json().flowDraft.revision, 6)
  assert.equal(revise.json().flowDraft.nodes[0].id, 'screen-step')
  assert.equal(revise.json().flowDraft.nodes[0].onError, undefined)
  assert.equal(revise.json().cfDrafts[0].revision, 2)
  assert.equal(store.get<any>('flow_drafts', 'same-flow').revision, 6)
  assert.equal(store.get<any>('cf_drafts', 'screen-cf').does, '使用屏幕稿中的职责')
  const reviseInput = await import('node:fs/promises').then(({ readFile }) =>
    readFile(capture, 'utf8'),
  )
  assert.match(reviseInput, /"revision":5/)
  assert.match(reviseInput, /上一轮结果/)
  assert.match(reviseInput, /LAST_CHECK_ERROR/)
  assert.match(reviseInput, /"nodeId":"screen-step"/)
})

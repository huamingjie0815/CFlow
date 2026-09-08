import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { delimiter, join } from 'node:path'
import {
  defaultRuntimeProfiles,
  defaultWorkspaceSettings,
  discoverRuntimeProfiles,
  isAcpToolAllowed,
  RuntimeExecutionException,
  RuntimeManager,
} from './runtime.js'
import { Store } from './db.js'
import type { RuntimeProfile } from './types.js'

test('discovers generic ACP runtime commands from PATH', () => {
  const directory = join('/tmp', `cf-acp-discovery-${randomUUID()}`)
  const command = join(directory, 'example-agent-acp')
  const previousPath = process.env.PATH
  mkdirSync(directory, { recursive: true })
  writeFileSync(command, '#!/bin/sh\nexit 0\n')
  chmodSync(command, 0o755)
  process.env.PATH = [directory, previousPath].filter(Boolean).join(delimiter)
  try {
    const runtime = defaultRuntimeProfiles().find((profile) => profile.id === 'example-agent-acp')
    assert.equal(runtime?.backend, 'acp')
    assert.equal(runtime?.command, 'example-agent-acp')
    assert.equal(runtime?.name, 'Example Agent ACP')
  } finally {
    process.env.PATH = previousPath
    rmSync(directory, { recursive: true, force: true })
  }
})

test('adds known external ACP adapters only when their local commands exist', () => {
  const root = join('/tmp', `cf-known-acp-${randomUUID()}`)
  const bin = join(root, 'bin')
  mkdirSync(bin, { recursive: true })
  for (const command of ['amp-acp', 'copilot']) {
    writeFileSync(join(bin, command), '#!/bin/sh\nexit 0\n')
    chmodSync(join(bin, command), 0o755)
  }
  try {
    const discovery = discoverRuntimeProfiles({
      projectRoot: root,
      env: { PATH: bin, HOME: root },
      userManifestDirectory: false,
      projectManifestDirectory: false,
      packageRoot: false,
      includeBuiltins: false,
    })
    assert.equal(discovery.profiles.find((profile) => profile.id === 'amp')?.command, 'amp-acp')
    assert.equal(
      discovery.profiles.some((profile) => profile.id === 'pi'),
      false,
    )
    assert.deepEqual(discovery.profiles.find((profile) => profile.id === 'github-copilot')?.args, [
      '--acp',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loads project manifests over user manifests without runtime-specific code', () => {
  const root = join('/tmp', `cf-manifest-discovery-${randomUUID()}`)
  const userDirectory = join(root, 'user')
  const projectDirectory = join(root, 'project', '.cflow', 'agents.d')
  mkdirSync(userDirectory, { recursive: true })
  mkdirSync(projectDirectory, { recursive: true })
  const manifest = (name: string) => ({
    schemaVersion: 1,
    id: 'grok-build',
    name,
    backend: 'cli',
    command: 'grok',
    permissionArgs: { none: ['--permission-mode', 'plan'] },
  })
  writeFileSync(join(userDirectory, 'grok.json'), JSON.stringify(manifest('User Grok')))
  writeFileSync(join(projectDirectory, 'grok.json'), JSON.stringify(manifest('Grok Build')))
  writeFileSync(join(projectDirectory, 'invalid.json'), JSON.stringify({ schemaVersion: 99 }))
  try {
    const discovery = discoverRuntimeProfiles({
      projectRoot: join(root, 'project'),
      userManifestDirectory: userDirectory,
      packageRoot: false,
      includeBuiltins: false,
    })
    const runtime = discovery.profiles.find((profile) => profile.id === 'grok-build')
    assert.equal(runtime?.name, 'Grok Build')
    assert.equal(runtime?.backend, 'cli')
    assert.equal(runtime?.discovery?.source, 'project-manifest')
    assert.deepEqual(runtime?.permissionArgs?.none, ['--permission-mode', 'plan'])
    assert.equal(discovery.warnings.length, 1)
    assert.match(discovery.warnings[0], /SCHEMA_VERSION_UNSUPPORTED/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loads package manifests and keeps Codex and Claude Code built in', () => {
  const root = join('/tmp', `cf-package-manifest-${randomUUID()}`)
  const packageDirectory = join(root, 'node_modules', 'example-cflow-agent')
  mkdirSync(packageDirectory, { recursive: true })
  writeFileSync(
    join(packageDirectory, 'package.json'),
    JSON.stringify({
      name: 'example-cflow-agent',
      cflowAgent: {
        schemaVersion: 1,
        id: 'example-agent',
        name: 'Example Agent',
        backend: 'acp',
        command: 'example-agent-acp',
      },
    }),
  )
  try {
    const discovery = discoverRuntimeProfiles({
      projectRoot: root,
      userManifestDirectory: false,
      projectManifestDirectory: false,
    })
    assert.equal(
      discovery.profiles.find((profile) => profile.id === 'example-agent')?.discovery?.source,
      'package-manifest',
    )
    assert.ok(discovery.profiles.some((profile) => profile.id === 'codex'))
    assert.ok(discovery.profiles.some((profile) => profile.id === 'claude-code'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('auto-allows declared ACP effects inside the workspace and rejects unsafe requests', () => {
  const root = '/tmp/cflow-workspace'
  const effects = [
    { type: 'file-read', scope: 'workspace', description: '读取工作区文件' },
    { type: 'file-write', scope: 'workspace', description: '修改工作区文件' },
    { type: 'command', scope: 'workspace', description: '运行工作区命令' },
  ] as const
  assert.equal(
    isAcpToolAllowed(
      { kind: 'file-write', locations: [{ path: 'src/index.ts' }] },
      [...effects],
      root,
      root,
    ),
    true,
  )
  assert.equal(
    isAcpToolAllowed(
      { kind: 'command', rawInput: { command: 'pnpm test' } },
      [...effects],
      root,
      root,
    ),
    true,
  )
  assert.equal(
    isAcpToolAllowed(
      { kind: 'other', name: 'Bash', rawInput: { command: 'python parse.py' } },
      [...effects],
      root,
      root,
    ),
    true,
  )
  assert.equal(
    isAcpToolAllowed(
      { kind: 'file-write', locations: [{ path: '/tmp/outside.txt' }] },
      [...effects],
      root,
      root,
    ),
    false,
  )
  assert.equal(
    isAcpToolAllowed(
      { kind: 'file-delete', locations: [{ path: 'src/index.ts' }] },
      [],
      root,
      root,
    ),
    false,
  )
  assert.equal(isAcpToolAllowed({ kind: 'file-read' }, [], root, root, true), false)
  assert.equal(
    isAcpToolAllowed(
      { kind: 'file-read', locations: [{ path: 'src/index.ts' }] },
      [],
      root,
      root,
      true,
    ),
    true,
  )
})

test('executes a discovered CLI runtime as a bounded child process', async () => {
  const directory = join('/tmp', `cf-cli-runtime-${randomUUID()}`)
  const executable = join(directory, 'fake-agent')
  const previousSecret = process.env.CFLOW_TEST_SECRET
  mkdirSync(directory, { recursive: true })
  const store = new Store(join(directory, 'runtime.sqlite'))
  writeFileSync(
    executable,
    '#!/bin/sh\nprintf \'{"ok":true,"secret":"%s"}\\n\' "${CFLOW_TEST_SECRET:-clean}"\n',
  )
  chmodSync(executable, 0o755)
  process.env.CFLOW_TEST_SECRET = 'must-not-leak'
  try {
    const manager = new RuntimeManager(store)
    manager.saveProfile({
      id: 'fake-agent',
      name: 'Fake Agent',
      backend: 'cli',
      command: executable,
      args: [],
      versionArgs: ['--version'],
      promptTransport: 'argument',
      outputMode: 'json',
      timeoutMs: 5_000,
      maxOutputBytes: 65_536,
      envAllowlist: ['PATH'],
      capabilities: [],
    })
    const result = await manager.execute(
      'fake-agent',
      'return JSON',
      {},
      AbortSignal.timeout(5_000),
    )
    assert.deepEqual(result, { ok: true, secret: 'clean' })
    const health = await manager.health('fake-agent')
    assert.equal(health.status, 'available')
    assert.equal(health.stage, 'adapter-ready')
  } finally {
    store.close()
    if (previousSecret === undefined) delete process.env.CFLOW_TEST_SECRET
    else process.env.CFLOW_TEST_SECRET = previousSecret
    rmSync(directory, { recursive: true, force: true })
  }
})

test('hides builtin echo and migrates a legacy echo default to Codex', () => {
  const root = join('/tmp', `cf-runtime-legacy-echo-${randomUUID()}`)
  mkdirSync(root, { recursive: true })
  const store = new Store(join(root, 'runtime.sqlite'))
  store.saveRuntimeProfile({
    id: 'echo',
    profileVersion: 1,
    name: 'Local Echo',
    enabled: true,
    backend: 'builtin',
    args: [],
    versionArgs: [],
    promptTransport: 'stdin',
    outputMode: 'json',
    timeoutMs: 5_000,
    maxOutputBytes: 65_536,
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
  })
  store.saveSettings(defaultWorkspaceSettings('echo'))
  try {
    const manager = new RuntimeManager(store, {
      projectRoot: root,
      userManifestDirectory: false,
      projectManifestDirectory: false,
      packageRoot: false,
    })
    assert.equal(manager.settings().defaultRuntimeId, 'codex')
    assert.ok(manager.profiles().every((profile) => profile.backend !== 'builtin'))
    assert.equal(manager.profile('echo')?.backend, 'builtin')
  } finally {
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('repairs and protects the hidden demo runtime', async () => {
  const root = join('/tmp', `cf-runtime-demo-${randomUUID()}`)
  mkdirSync(root, { recursive: true })
  const store = new Store(join(root, 'runtime.sqlite'))
  try {
    const manager = new RuntimeManager(store, {
      projectRoot: root,
      userManifestDirectory: false,
      projectManifestDirectory: false,
      packageRoot: false,
    })
    assert.equal(manager.profile('cflow-demo')?.backend, 'builtin')
    assert.ok(manager.profiles().every((profile) => profile.id !== 'cflow-demo'))
    const health = await manager.health('cflow-demo')
    assert.equal(health.status, 'available')
    assert.throws(
      () => manager.validateSettings({ defaultRuntimeId: 'cflow-demo' }),
      /DEFAULT_RUNTIME_NOT_SELECTABLE/,
    )
    assert.throws(
      () =>
        manager.saveProfile({
          id: 'cflow-demo',
          name: 'External demo replacement',
          backend: 'cli',
          command: '/bin/false',
        }),
      /RUNTIME_ID_RESERVED/,
    )

    const builtin = manager.profile('cflow-demo')!
    store.saveRuntimeProfile({
      ...builtin,
      profileVersion: store.nextRuntimeProfileVersion('cflow-demo'),
      name: 'Legacy collision',
      enabled: false,
      backend: 'cli',
      command: '/bin/false',
      discovery: { source: 'manual' },
      createdAt: new Date().toISOString(),
    } as RuntimeProfile)
    const repaired = new RuntimeManager(store, {
      projectRoot: root,
      userManifestDirectory: false,
      projectManifestDirectory: false,
      packageRoot: false,
    })
    assert.equal(repaired.profile('cflow-demo')?.backend, 'builtin')
    assert.equal(repaired.profile('cflow-demo')?.enabled, true)
    assert.equal(repaired.profile('cflow-demo')?.discovery?.source, 'builtin')

    const result = await repaired.execute('cflow-demo', 'ignored', {}, AbortSignal.timeout(1_000))
    assert.equal((result as { title?: string }).title, 'Hello World')
    assert.match(String((result as { html?: string }).html), /你好，世界/)
  } finally {
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('marks an ACP runtime available only after an initialize handshake', async () => {
  const root = join('/tmp', `cf-acp-health-${randomUUID()}`)
  const executable = join(root, 'fake-agent-acp')
  const previousPath = process.env.PATH
  mkdirSync(root, { recursive: true })
  writeFileSync(
    executable,
    `#!/usr/bin/env node
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  const newline = buffer.indexOf('\\n')
  if (newline < 0) return
  const request = JSON.parse(buffer.slice(0, newline))
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: request.id,
    result: {
      protocolVersion: request.params.protocolVersion,
      agentCapabilities: {},
      authMethods: [],
      agentInfo: { name: 'Fake ACP', version: '1.0.0' }
    }
  }) + '\\n')
})
`,
  )
  chmodSync(executable, 0o755)
  process.env.PATH = [root, previousPath].filter(Boolean).join(delimiter)
  const store = new Store(join(root, 'runtime.sqlite'))
  try {
    const manager = new RuntimeManager(store, {
      projectRoot: root,
      userManifestDirectory: false,
      projectManifestDirectory: false,
      packageRoot: false,
      includeBuiltins: false,
    })
    const health = await manager.health('fake-agent-acp')
    assert.equal(health.status, 'available')
    assert.equal(health.stage, 'protocol-ready')
    assert.match(health.version ?? '', /Fake ACP 1\.0\.0/)
  } finally {
    store.close()
    process.env.PATH = previousPath
    rmSync(root, { recursive: true, force: true })
  }
})

test('retries a bundled ACP runtime after a transient cold-start failure', async () => {
  const root = join('/tmp', `cf-acp-cold-start-${randomUUID()}`)
  const executable = join(root, 'cold-start-acp')
  const attempts = join(root, 'attempts')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs')
const attempts = ${JSON.stringify(attempts)}
appendFileSync(attempts, '1')
if (readFileSync(attempts, 'utf8').length === 1) process.exit(1)
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  const newline = buffer.indexOf('\\n')
  if (newline < 0) return
  const request = JSON.parse(buffer.slice(0, newline))
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {
    protocolVersion: request.params.protocolVersion,
    agentCapabilities: {}, authMethods: []
  } }) + '\\n')
})
`,
  )
  chmodSync(executable, 0o755)
  const store = new Store(join(root, 'runtime.sqlite'))
  try {
    const manager = new RuntimeManager(store, {
      projectRoot: root,
      userManifestDirectory: false,
      projectManifestDirectory: false,
      packageRoot: false,
    })
    const codex = manager.profile('codex')!
    store.saveRuntimeProfile({
      ...codex,
      profileVersion: store.nextRuntimeProfileVersion('codex'),
      command: executable,
    })
    const health = await manager.health('codex')
    assert.equal(health.status, 'available', health.error)
    assert.equal(readFileSync(attempts, 'utf8'), '11')
  } finally {
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('coalesces concurrent health checks for the same runtime profile', async () => {
  const root = join('/tmp', `cf-acp-coalesced-health-${randomUUID()}`)
  const executable = join(root, 'coalesced-acp')
  const attempts = join(root, 'attempts')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
appendFileSync(${JSON.stringify(attempts)}, '1')
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  const newline = buffer.indexOf('\\n')
  if (newline < 0) return
  const request = JSON.parse(buffer.slice(0, newline))
  setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {
    protocolVersion: request.params.protocolVersion,
    agentCapabilities: {}, authMethods: []
  } }) + '\\n'), 100)
})
`,
  )
  chmodSync(executable, 0o755)
  const store = new Store(join(root, 'runtime.sqlite'))
  try {
    const manager = new RuntimeManager(store, {
      projectRoot: root,
      userManifestDirectory: false,
      projectManifestDirectory: false,
      packageRoot: false,
      includeBuiltins: false,
    })
    manager.saveProfile({
      id: 'coalesced-acp',
      name: 'Coalesced ACP',
      backend: 'acp',
      command: executable,
    })
    const [first, second] = await Promise.all([
      manager.health('coalesced-acp'),
      manager.health('coalesced-acp'),
    ])
    assert.equal(first.status, 'available')
    assert.deepEqual(second, first)
    assert.equal(readFileSync(attempts, 'utf8'), '1')
  } finally {
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('bundled adapters require installed Codex and Claude CLIs', async () => {
  const root = join('/tmp', `cf-missing-agent-clis-${randomUUID()}`)
  const bin = join(root, 'bin')
  const adapter = join(root, 'fake-acp')
  const previousPath = process.env.PATH
  const previousCodex = process.env.CFLOW_CODEX_PATH
  const previousClaude = process.env.CFLOW_CLAUDE_PATH
  const previousCodexHome = process.env.CODEX_HOME
  mkdirSync(bin, { recursive: true })
  mkdirSync(join(root, 'codex-home'), { recursive: true })
  symlinkSync(process.execPath, join(bin, 'node'))
  writeFileSync(
    adapter,
    `#!/usr/bin/env node
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  const newline = buffer.indexOf('\\n')
  if (newline < 0) return
  const request = JSON.parse(buffer.slice(0, newline))
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {
    protocolVersion: request.params.protocolVersion,
    agentCapabilities: {}, authMethods: []
  } }) + '\\n')
})
`,
  )
  chmodSync(adapter, 0o755)
  process.env.PATH = bin
  delete process.env.CFLOW_CODEX_PATH
  delete process.env.CFLOW_CLAUDE_PATH
  process.env.CODEX_HOME = join(root, 'codex-home')
  const store = new Store(join(root, 'runtime.sqlite'))
  try {
    const manager = new RuntimeManager(store, {
      projectRoot: root,
      userManifestDirectory: false,
      projectManifestDirectory: false,
      packageRoot: false,
      healthTimeoutMs: 8_000,
    })
    for (const id of ['codex', 'claude-code']) {
      const profile = manager.profile(id)!
      store.saveRuntimeProfile({
        ...profile,
        profileVersion: store.nextRuntimeProfileVersion(id),
        command: adapter,
      })
    }
    const [codex, claude] = await Promise.all([
      manager.health('codex'),
      manager.health('claude-code'),
    ])
    assert.equal(codex.status, 'unavailable')
    assert.equal(claude.status, 'unavailable')
    assert.match(codex.error ?? '', /CODEX_CLI_NOT_FOUND:codex/)
    assert.match(claude.error ?? '', /CLAUDE_CODE_CLI_NOT_FOUND:claude/)

    for (const command of ['codex', 'claude']) {
      writeFileSync(join(bin, command), '#!/bin/sh\nexit 0\n')
      chmodSync(join(bin, command), 0o755)
    }
    const [installedCodex, installedClaude] = await Promise.all([
      manager.health('codex'),
      manager.health('claude-code'),
    ])
    assert.equal(installedCodex.status, 'available', installedCodex.error)
    assert.equal(installedClaude.status, 'available', installedClaude.error)
  } finally {
    store.close()
    process.env.PATH = previousPath
    if (previousCodex === undefined) delete process.env.CFLOW_CODEX_PATH
    else process.env.CFLOW_CODEX_PATH = previousCodex
    if (previousClaude === undefined) delete process.env.CFLOW_CLAUDE_PATH
    else process.env.CFLOW_CLAUDE_PATH = previousClaude
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = previousCodexHome
    rmSync(root, { recursive: true, force: true })
  }
})

test('ACP health reports handshake timeout, stderr and resolved launch details', async () => {
  const root = join('/tmp', `cf-acp-diagnostics-${randomUUID()}`)
  const previousPath = process.env.PATH
  mkdirSync(root, { recursive: true })
  const hanging = join(root, 'hanging-acp')
  const failing = join(root, 'failing-acp')
  writeFileSync(hanging, '#!/usr/bin/env node\nprocess.stdin.resume()\n')
  writeFileSync(failing, '#!/bin/sh\nprintf "adapter setup failed\\n" >&2\nexit 2\n')
  chmodSync(hanging, 0o755)
  chmodSync(failing, 0o755)
  process.env.PATH = [root, previousPath].filter(Boolean).join(delimiter)
  const store = new Store(join(root, 'runtime.sqlite'))
  try {
    const discovery = {
      projectRoot: root,
      userManifestDirectory: false,
      projectManifestDirectory: false,
      packageRoot: false,
      includeBuiltins: false,
    } as const
    const timedOut = await new RuntimeManager(store, {
      ...discovery,
      healthTimeoutMs: 500,
    }).health('hanging-acp')
    const failed = await new RuntimeManager(store, {
      ...discovery,
      healthTimeoutMs: 5_000,
    }).health('failing-acp')
    assert.equal(timedOut.status, 'unavailable')
    assert.match(timedOut.error ?? '', /ACP_HANDSHAKE_TIMEOUT/)
    assert.match(timedOut.error ?? '', /\[launch=native /)
    assert.equal(failed.status, 'unavailable')
    assert.match(failed.error ?? '', /adapter setup failed/)
    assert.match(failed.error ?? '', /\[launch=native /)
  } finally {
    store.close()
    process.env.PATH = previousPath
    rmSync(root, { recursive: true, force: true })
  }
})

test('cancels a running ACP session and terminates its child process', async () => {
  const root = join('/tmp', `cf-acp-cancel-${randomUUID()}`)
  const previousPath = process.env.PATH
  mkdirSync(root, { recursive: true })
  const executable = join(root, 'cancel-acp')
  writeFileSync(
    executable,
    `#!/usr/bin/env node
let buffer = ''
let requestCount = 0
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  while (buffer.includes('\\n')) {
    const newline = buffer.indexOf('\\n')
    const request = JSON.parse(buffer.slice(0, newline))
    buffer = buffer.slice(newline + 1)
    requestCount += 1
    if (requestCount === 1) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {
        protocolVersion: request.params.protocolVersion,
        agentCapabilities: {}, authMethods: []
      } }) + '\\n')
    } else if (requestCount === 2) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {
        sessionId: 'cancel-session'
      } }) + '\\n')
    }
  }
})
`,
  )
  chmodSync(executable, 0o755)
  process.env.PATH = [root, previousPath].filter(Boolean).join(delimiter)
  const store = new Store(join(root, 'runtime.sqlite'))
  try {
    const manager = new RuntimeManager(store, {
      projectRoot: root,
      userManifestDirectory: false,
      projectManifestDirectory: false,
      packageRoot: false,
      includeBuiltins: false,
    })
    const controller = new AbortController()
    const execution = manager.execute('cancel-acp', 'wait', {}, controller.signal)
    setTimeout(() => controller.abort(), 100)
    await assert.rejects(execution, (error) => {
      assert.ok(error instanceof RuntimeExecutionException)
      assert.equal(error.details.code, 'RUN_CANCELLED')
      return true
    })
  } finally {
    store.close()
    process.env.PATH = previousPath
    rmSync(root, { recursive: true, force: true })
  }
})

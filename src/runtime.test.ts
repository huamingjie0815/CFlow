import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { delimiter, join } from 'node:path'
import {
  defaultRuntimeProfiles,
  defaultWorkspaceSettings,
  discoverRuntimeProfiles,
  RuntimeManager,
} from './runtime.js'
import { Store } from './db.js'

test('discovers generic ACP runtime commands from PATH', () => {
  const directory = join('/tmp', `cf-acp-discovery-${randomUUID()}`)
  const command = join(directory, 'example-agent-acp.cmd')
  const previousPath = process.env.PATH
  const previousPathExt = process.env.PATHEXT
  mkdirSync(directory, { recursive: true })
  writeFileSync(command, '@echo off\nexit /b 0\n')
  chmodSync(command, 0o755)
  process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD;.PS1'
  process.env.PATH = [directory, previousPath].filter(Boolean).join(delimiter)
  try {
    const runtime = defaultRuntimeProfiles().find((profile) => profile.id === 'example-agent-acp')
    assert.equal(runtime?.backend, 'acp')
    assert.equal(runtime?.command, 'example-agent-acp')
    assert.equal(runtime?.name, 'Example Agent ACP')
  } finally {
    process.env.PATH = previousPath
    if (previousPathExt === undefined) delete process.env.PATHEXT
    else process.env.PATHEXT = previousPathExt
    rmSync(directory, { recursive: true, force: true })
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

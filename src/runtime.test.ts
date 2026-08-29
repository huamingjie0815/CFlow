import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { delimiter, join } from 'node:path'
import { defaultRuntimeProfiles } from './runtime.js'

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

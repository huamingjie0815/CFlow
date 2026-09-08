import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { discoverAcpCommands, resolveCommand } from './runtime-process.js'

const temporaryRoot = () => join('/tmp', `cflow-runtime-process-${randomUUID()}`)

const executableFile = (path: string, content = '#!/bin/sh\nexit 0\n') => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

test('Windows command resolution skips extensionless npm and PowerShell shims', () => {
  const root = temporaryRoot()
  const bundledBin = join(root, 'node_modules', '.bin')
  mkdirSync(bundledBin, { recursive: true })
  for (const name of ['sample-acp', 'sample-acp.cmd', 'sample-acp.ps1'])
    writeFileSync(join(bundledBin, name), 'shim')
  try {
    const options = {
      bundledRoot: root,
      projectRoot: join(root, 'project'),
      platform: 'win32' as const,
      env: { PATH: '', PATHEXT: '.PS1;.CMD;.EXE;.BAT;.COM' },
    }
    const resolved = resolveCommand('sample-acp', options)
    assert.equal(resolved?.executable, join(bundledBin, 'sample-acp.cmd'))
    assert.equal(resolved?.launchType, 'windows-command')
    assert.equal(resolveCommand(join(bundledBin, 'sample-acp.ps1'), options), undefined)
    assert.deepEqual(discoverAcpCommands(options), ['sample-acp'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('command resolution covers bundled, project, PATH and Windows npm locations in order', () => {
  const root = temporaryRoot()
  const project = join(root, 'project')
  const pathBin = join(root, 'path-bin')
  const appData = join(root, 'App Data')
  const paths = [
    join(root, 'node_modules', '.bin', 'agent.exe'),
    join(project, 'node_modules', '.bin', 'agent.exe'),
    join(pathBin, 'agent.exe'),
    join(appData, 'npm', 'agent.exe'),
  ]
  for (const path of paths) executableFile(path, 'binary')
  const options = {
    bundledRoot: root,
    projectRoot: project,
    platform: 'win32' as const,
    env: { PATH: pathBin, PATHEXT: '.EXE;.BAT;.CMD;.COM', APPDATA: appData },
  }
  try {
    assert.equal(resolveCommand('agent', options)?.source, 'bundled-bin')
    rmSync(paths[0])
    assert.equal(resolveCommand('agent', options)?.source, 'project-bin')
    rmSync(paths[1])
    assert.equal(resolveCommand('agent', options)?.source, 'path')
    rmSync(paths[2])
    assert.equal(resolveCommand('agent', options)?.source, 'windows-appdata')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('command resolution can exclude CFlow bundled binaries from agent CLI detection', () => {
  const root = temporaryRoot()
  const bundledBin = join(root, 'node_modules', '.bin')
  const externalBin = join(root, 'external-bin')
  executableFile(join(bundledBin, 'agent'))
  try {
    const options = {
      bundledRoot: root,
      projectRoot: join(root, 'project'),
      env: { PATH: bundledBin, HOME: root },
      excludedSources: ['bundled-bin' as const],
    }
    assert.equal(resolveCommand('agent', options), undefined)

    executableFile(join(externalBin, 'agent'))
    options.env.PATH = [bundledBin, externalBin].join(delimiter)
    assert.equal(resolveCommand('agent', options)?.executable, join(externalBin, 'agent'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('explicit executables support spaces, .bat files and extension inference', () => {
  const root = temporaryRoot()
  const directory = join(root, 'Agent Tools')
  const executable = join(directory, 'custom agent.bat')
  executableFile(executable, 'binary')
  const options = {
    platform: 'win32' as const,
    env: { PATH: '', PATHEXT: '.EXE;.BAT;.CMD;.COM' },
    projectRoot: root,
  }
  try {
    assert.equal(resolveCommand(executable, options)?.executable, executable)
    assert.equal(resolveCommand(executable.slice(0, -4), options)?.executable, executable)
    assert.equal(resolveCommand(executable, options)?.launchType, 'windows-command')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

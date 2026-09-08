import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { browserAddress, openCFlowBrowser, runCFlowCli } from './cli.js'

test('normalizes wildcard listen addresses for the browser', () => {
  assert.equal(browserAddress('http://0.0.0.0:4317'), 'http://127.0.0.1:4317')
  assert.equal(browserAddress('http://[::]:4317'), 'http://[::1]:4317')
  assert.equal(browserAddress('http://127.0.0.1:4317'), 'http://127.0.0.1:4317')
})

test('opens after receiving the actual listen address unless disabled', async () => {
  const opened: string[] = []
  const opener = async (url: string) => opened.push(url)
  assert.equal(await openCFlowBrowser('http://0.0.0.0:49321', {}, opener), true)
  assert.deepEqual(opened, ['http://127.0.0.1:49321'])
  assert.equal(
    await openCFlowBrowser('http://127.0.0.1:49322', { CFLOW_NO_OPEN: '1' }, opener),
    false,
  )
  assert.equal(opened.length, 1)
})

test('browser launch failure is reported without rejecting', async () => {
  const warnings: string[] = []
  const result = await openCFlowBrowser(
    'http://127.0.0.1:3000',
    {},
    async () => {
      throw new Error('no browser')
    },
    (message) => warnings.push(message),
  )
  assert.equal(result, false)
  assert.match(warnings[0] ?? '', /请手动访问 http:\/\/127\.0\.0\.1:3000/)
})

test('formal CLI opens the actual address after the server starts listening', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'cflow-cli-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  const opened: string[] = []
  const result = await runCFlowCli({
    workspaceRoot: workspace,
    environment: { HOST: '127.0.0.1', PORT: '0' },
    log: () => undefined,
    opener: async (url) => {
      const response = await fetch(`${url}/api/workspace`)
      assert.equal(response.status, 200)
      opened.push(url)
    },
  })
  t.after(() => result.app.close())
  assert.deepEqual(opened, [browserAddress(result.address)])
  assert.notEqual(new URL(result.address).port, '0')
})

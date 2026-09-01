import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { initializeWorkspace } from './workspace.js'

const temporaryWorkspace = () => join('/tmp', `cflow-workspace-${randomUUID()}`)

test('initializes local CFlow data without hiding project manifests', (t) => {
  const root = temporaryWorkspace()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '.cflow'), { recursive: true })
  writeFileSync(join(root, '.cflow', '.gitignore'), '# user rule\n/custom\n')

  const first = initializeWorkspace(root, {})
  const second = initializeWorkspace(root, {})
  const ignore = readFileSync(join(root, '.cflow', '.gitignore'), 'utf8')

  const normalizedRoot = realpathSync(root)
  assert.equal(first.root, normalizedRoot)
  assert.equal(first.databasePath, join(normalizedRoot, '.cflow', 'cflow.sqlite'))
  assert.deepEqual(second, first)
  assert.match(ignore, /# user rule\n\/custom/)
  assert.match(ignore, /\/cflow\.sqlite/)
  assert.match(ignore, /\/flows\//)
  assert.doesNotMatch(ignore, /agents\.d/)
  assert.equal(ignore.match(/# cflow:local-data/g)?.length, 1)
})

test('rejects the removed CF_DB override', (t) => {
  const root = temporaryWorkspace()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(root, { recursive: true })

  assert.throws(
    () => initializeWorkspace(root, { CF_DB: join(root, 'legacy.sqlite') }),
    /CF_DB_UNSUPPORTED/,
  )
})

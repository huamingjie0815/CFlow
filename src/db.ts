import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  Json,
  FlowCompilationSnapshot,
  LedgerEvent,
  ResolvedResource,
  ResourceProfile,
  RuntimeProfile,
  WorkspaceSettings,
} from './types.js'
export class Store {
  readonly db: Database
  constructor(file = process.env.CF_DB ?? './data/cf.sqlite') {
    mkdirSync(dirname(file), { recursive: true })
    this.db = new Database(file)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('busy_timeout = 5000')
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS cf_drafts (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS cf_versions (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS flow_drafts (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS flow_versions (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS flow_compilations (id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, flow_revision INTEGER NOT NULL, mode TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, flow_version_id TEXT NOT NULL, status TEXT NOT NULL, value TEXT NOT NULL, input TEXT NOT NULL DEFAULT '{}', resource_profile_id TEXT, resources TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS ledger_events (run_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, node INTEGER, data TEXT, at TEXT NOT NULL, PRIMARY KEY(run_id, seq)); CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, lease_until INTEGER, attempts INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS approvals (run_id TEXT NOT NULL, node INTEGER NOT NULL, decision TEXT, decided_at TEXT, PRIMARY KEY(run_id,node)); CREATE TABLE IF NOT EXISTS resource_profiles (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runtime_profiles (id TEXT PRIMARY KEY, runtime_id TEXT NOT NULL, profile_version INTEGER NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runtime_current (runtime_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workspace_settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);`,
    )
    const columns = this.db.prepare('PRAGMA table_info(runs)').all() as { name: string }[]
    if (!columns.some((column) => column.name === 'input'))
      this.db.exec("ALTER TABLE runs ADD COLUMN input TEXT NOT NULL DEFAULT '{}'")
    if (!columns.some((column) => column.name === 'resource_profile_id'))
      this.db.exec('ALTER TABLE runs ADD COLUMN resource_profile_id TEXT')
    if (!columns.some((column) => column.name === 'resources'))
      this.db.exec("ALTER TABLE runs ADD COLUMN resources TEXT NOT NULL DEFAULT '[]'")
  }
  saveFlowCompilation(snapshot: FlowCompilationSnapshot) {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO flow_compilations(id,flow_id,flow_revision,mode,value,created_at) VALUES(?,?,?,?,?,?)',
      )
      .run(
        snapshot.id,
        snapshot.flowId,
        snapshot.flowRevision,
        snapshot.mode,
        JSON.stringify(snapshot),
        snapshot.createdAt,
      )
  }
  flowCompilations(): FlowCompilationSnapshot[] {
    return (
      this.db
        .prepare('SELECT value FROM flow_compilations ORDER BY created_at DESC, id DESC')
        .all() as { value: string }[]
    ).map((row) => JSON.parse(row.value) as FlowCompilationSnapshot)
  }
  save(
    table: 'cf_drafts' | 'cf_versions' | 'flow_drafts' | 'flow_versions',
    id: string,
    value: object,
  ) {
    this.db
      .prepare(`INSERT OR REPLACE INTO ${table}(id,value) VALUES(?,?)`)
      .run(id, JSON.stringify(value))
  }
  get<T>(
    table: 'cf_drafts' | 'cf_versions' | 'flow_drafts' | 'flow_versions',
    id: string,
  ): T | undefined {
    const row = this.db.prepare(`SELECT value FROM ${table} WHERE id=?`).get(id) as
      { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : undefined
  }
  list<T>(table: 'cf_drafts' | 'cf_versions' | 'flow_drafts' | 'flow_versions'): T[] {
    return (
      this.db.prepare(`SELECT value FROM ${table} ORDER BY id`).all() as { value: string }[]
    ).map((r) => JSON.parse(r.value) as T)
  }
  createRun(
    id: string,
    flowVersionId: string,
    input: Json = {},
    resources: ResolvedResource[] = [],
    resourceProfileId?: string,
  ) {
    const now = new Date().toISOString()
    this.db
      .prepare(
        'INSERT INTO runs(id,flow_version_id,status,value,input,resource_profile_id,resources,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        flowVersionId,
        'queued',
        '{}',
        JSON.stringify(input),
        resourceProfileId ?? null,
        JSON.stringify(resources),
        now,
        now,
      )
    this.db.prepare('INSERT INTO jobs(id,run_id,status) VALUES(?,?,?)').run(id, id, 'queued')
  }
  getRun<T = Json>(id: string) {
    const row = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as any
    return row
      ? {
          ...row,
          value: JSON.parse(row.value) as T,
          input: JSON.parse(row.input ?? '{}') as Json,
          resources: JSON.parse(row.resources ?? '[]') as ResolvedResource[],
        }
      : undefined
  }
  runs<T = Json>() {
    return (this.db.prepare('SELECT * FROM runs ORDER BY created_at DESC').all() as any[]).map(
      (row) => ({
        ...row,
        value: JSON.parse(row.value) as T,
        input: JSON.parse(row.input ?? '{}') as Json,
        resources: JSON.parse(row.resources ?? '[]') as ResolvedResource[],
      }),
    )
  }
  setRun(id: string, status: string, value: Json = {}) {
    this.db
      .prepare('UPDATE runs SET status=?,value=?,updated_at=? WHERE id=?')
      .run(status, JSON.stringify(value), new Date().toISOString(), id)
  }
  append(runId: string, type: string, node?: number, data?: Json): LedgerEvent {
    const tx = this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT COALESCE(MAX(seq),0)+1 seq FROM ledger_events WHERE run_id=?')
        .get(runId) as { seq: number }
      const event = { seq: row.seq, runId, type, node, data, at: new Date().toISOString() }
      this.db
        .prepare('INSERT INTO ledger_events(run_id,seq,type,node,data,at) VALUES(?,?,?,?,?,?)')
        .run(
          runId,
          event.seq,
          type,
          node,
          data === undefined ? null : JSON.stringify(data),
          event.at,
        )
      return event
    })
    return tx()
  }
  events(runId: string): LedgerEvent[] {
    return (
      this.db.prepare('SELECT * FROM ledger_events WHERE run_id=? ORDER BY seq').all(runId) as any[]
    ).map((r) => ({
      seq: r.seq,
      runId,
      type: r.type,
      node: r.node ?? undefined,
      data: r.data ? JSON.parse(r.data) : undefined,
      at: r.at,
    }))
  }
  claimJob(): { id: string; runId: string } | undefined {
    const now = Date.now()
    const tx = this.db.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT id,run_id FROM jobs WHERE status='queued' OR (status='running' AND lease_until<?) ORDER BY id LIMIT 1",
        )
        .get(now) as any
      if (!row) return undefined
      this.db
        .prepare("UPDATE jobs SET status='running',lease_until=?,attempts=attempts+1 WHERE id=?")
        .run(now + 30000, row.id)
      return { id: row.id, runId: row.run_id }
    })
    return tx()
  }
  finishJob(id: string) {
    this.db.prepare("UPDATE jobs SET status='done',lease_until=NULL WHERE id=?").run(id)
  }
  approval(runId: string, node: number) {
    return (
      (
        this.db
          .prepare('SELECT decision FROM approvals WHERE run_id=? AND node=?')
          .get(runId, node) as { decision: string | null } | undefined
      )?.decision ?? undefined
    )
  }
  decideApproval(runId: string, node: number, decision: 'approved' | 'rejected') {
    this.db
      .prepare('INSERT OR REPLACE INTO approvals(run_id,node,decision,decided_at) VALUES(?,?,?,?)')
      .run(runId, node, decision, new Date().toISOString())
    this.append(runId, `approval.${decision}`, node)
  }
  saveResourceProfile(id: string, value: object) {
    this.db
      .prepare('INSERT OR REPLACE INTO resource_profiles(id,value) VALUES(?,?)')
      .run(id, JSON.stringify(value))
  }
  getResourceProfile(id: string) {
    const row = this.db.prepare('SELECT value FROM resource_profiles WHERE id=?').get(id) as
      { value: string } | undefined
    return row ? (JSON.parse(row.value) as ResourceProfile) : undefined
  }
  resourceProfiles<T>() {
    return (
      this.db.prepare('SELECT value FROM resource_profiles ORDER BY id').all() as {
        value: string
      }[]
    ).map((row) => JSON.parse(row.value) as T)
  }
  deleteResourceProfile(id: string) {
    return this.db.prepare('DELETE FROM resource_profiles WHERE id=?').run(id) as {
      changes?: number
    }
  }
  saveRuntimeProfile(profile: RuntimeProfile) {
    const profileId = `${profile.id}@${profile.profileVersion}`
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO runtime_profiles(id,runtime_id,profile_version,value,created_at) VALUES(?,?,?,?,?)',
        )
        .run(
          profileId,
          profile.id,
          profile.profileVersion,
          JSON.stringify(profile),
          profile.createdAt,
        )
      this.db
        .prepare('INSERT OR REPLACE INTO runtime_current(runtime_id,profile_id) VALUES(?,?)')
        .run(profile.id, profileId)
    })
    tx()
  }
  currentRuntimeProfiles(): RuntimeProfile[] {
    return (
      this.db
        .prepare(
          'SELECT p.value FROM runtime_current c JOIN runtime_profiles p ON p.id=c.profile_id ORDER BY c.runtime_id',
        )
        .all() as { value: string }[]
    ).map((row) => JSON.parse(row.value) as RuntimeProfile)
  }
  runtimeProfile(id: string, version?: number): RuntimeProfile | undefined {
    const row = version
      ? (this.db
          .prepare('SELECT value FROM runtime_profiles WHERE runtime_id=? AND profile_version=?')
          .get(id, version) as { value: string } | undefined)
      : (this.db
          .prepare(
            'SELECT p.value FROM runtime_current c JOIN runtime_profiles p ON p.id=c.profile_id WHERE c.runtime_id=?',
          )
          .get(id) as { value: string } | undefined)
    return row ? (JSON.parse(row.value) as RuntimeProfile) : undefined
  }
  runtimeProfileHistory(id: string): RuntimeProfile[] {
    return (
      this.db
        .prepare('SELECT value FROM runtime_profiles WHERE runtime_id=? ORDER BY profile_version DESC')
        .all(id) as { value: string }[]
    ).map((row) => JSON.parse(row.value) as RuntimeProfile)
  }
  allRuntimeProfiles(): RuntimeProfile[] {
    return (
      this.db.prepare('SELECT value FROM runtime_profiles ORDER BY runtime_id,profile_version').all() as {
        value: string
      }[]
    ).map((row) => JSON.parse(row.value) as RuntimeProfile)
  }
  nextRuntimeProfileVersion(id: string) {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(profile_version),0)+1 version FROM runtime_profiles WHERE runtime_id=?')
      .get(id) as { version: number }
    return row.version
  }
  settings(): WorkspaceSettings | undefined {
    const row = this.db.prepare("SELECT value FROM workspace_settings WHERE id='workspace'").get() as
      | { value: string }
      | undefined
    return row ? (JSON.parse(row.value) as WorkspaceSettings) : undefined
  }
  saveSettings(settings: WorkspaceSettings) {
    this.db
      .prepare("INSERT OR REPLACE INTO workspace_settings(id,value) VALUES('workspace',?)")
      .run(JSON.stringify(settings))
  }
  close() {
    this.db.close()
  }
}

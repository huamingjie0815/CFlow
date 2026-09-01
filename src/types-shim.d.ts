declare module 'better-sqlite3' {
  interface Statement {
    run(...params: unknown[]): unknown
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
  interface Database {
    pragma(value: string): unknown
    exec(value: string): void
    prepare(value: string): Statement
    transaction<T>(fn: () => T): () => T
    close(): void
  }
  const Database: { new (file: string): Database }
  export default Database
}

declare module 'cross-spawn' {
  import type { ChildProcess, SpawnOptions } from 'node:child_process'
  const spawn: (command: string, args?: readonly string[], options?: SpawnOptions) => ChildProcess
  export default spawn
}

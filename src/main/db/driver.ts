// SQLite 드라이버. Node 내장 node:sqlite 를 우선 쓰고, 없으면 better-sqlite3 로 전환한다.
// 두 드라이버의 차이(불리언/undefined 파라미터 등)는 여기서 흡수한다.

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

export interface Stmt {
  run(...params: unknown[]): RunResult
  get<T = Record<string, unknown>>(...params: unknown[]): T | undefined
  all<T = Record<string, unknown>>(...params: unknown[]): T[]
}

export interface Db {
  readonly driver: string
  prepare(sql: string): Stmt
  exec(sql: string): void
  tx<T>(fn: () => T): T
  close(): void
}

type RawStmt = {
  run(...p: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  get(...p: unknown[]): unknown
  all(...p: unknown[]): unknown[]
}
type RawDb = { prepare(sql: string): RawStmt; exec(sql: string): void; close(): void }

function clean(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (p === undefined) return null
    if (typeof p === 'boolean') return p ? 1 : 0
    return p
  })
}

function wrap(raw: RawDb, driver: string): Db {
  const cache = new Map<string, Stmt>()
  let depth = 0
  const db: Db = {
    driver,
    prepare(sql) {
      const hit = cache.get(sql)
      if (hit) return hit
      const s = raw.prepare(sql)
      const st: Stmt = {
        run: (...p) => {
          const r = s.run(...clean(p))
          return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
        },
        get: (...p) => (s.get(...clean(p)) ?? undefined) as never,
        all: (...p) => s.all(...clean(p)) as never
      }
      cache.set(sql, st)
      return st
    },
    exec: (sql) => raw.exec(sql),
    tx(fn) {
      // 중첩 호출은 바깥 트랜잭션에 합친다
      if (depth > 0) return fn()
      depth++
      raw.exec('BEGIN')
      try {
        const out = fn()
        raw.exec('COMMIT')
        return out
      } catch (e) {
        raw.exec('ROLLBACK')
        throw e
      } finally {
        depth--
      }
    },
    close: () => raw.close()
  }
  return db
}

export function openDatabase(file: string): Db {
  const errors: string[] = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (f: string) => RawDb }
    const raw = new DatabaseSync(file)
    return wrap(raw, 'node:sqlite')
  } catch (e) {
    errors.push(`node:sqlite: ${(e as Error).message}`)
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Better = require('better-sqlite3') as new (f: string) => RawDb
    const raw = new Better(file)
    return wrap(raw, 'better-sqlite3')
  } catch (e) {
    errors.push(`better-sqlite3: ${(e as Error).message}`)
  }
  throw new Error(`SQLite를 열 수 없습니다.\n${errors.join('\n')}`)
}

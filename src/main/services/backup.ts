// 자동 백업: 7일에 한 번 데이터 폴더의 backups 에 auto-날짜.db 로 저장하고, 최근 8개만 남긴다.
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../db/driver'
import type { Repo } from '../db/repo'

const EVERY_MS = 7 * 86_400_000
export const AUTO_KEEP = 8

/** 백업했으면 파일 경로, 아직 때가 아니면 null */
export function autoBackupIfDue(db: Db, repo: Repo, dir: string, now = Date.now()): string | null {
  const last = Number(repo.getMeta('last_auto_backup_at') ?? 0)
  if (now - last < EVERY_MS) return null
  mkdirSync(dir, { recursive: true })
  const stamp = new Date(now).toISOString().slice(0, 10)
  const file = join(dir, `auto-${stamp}.db`)
  try {
    unlinkSync(file)
  } catch {
    // 없으면 무시
  }
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  repo.setMeta('last_auto_backup_at', String(now))
  // 오래된 자동 백업 정리 (직접 만든 백업·초기화 전 백업은 건드리지 않는다)
  const autos = readdirSync(dir)
    .filter((f) => /^auto-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
  for (const f of autos.slice(0, Math.max(0, autos.length - AUTO_KEEP))) {
    try {
      unlinkSync(join(dir, f))
    } catch {
      // 다음에 다시 시도
    }
  }
  return file
}

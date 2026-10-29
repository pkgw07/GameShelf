import type { Db } from './driver'
import type {
  AchievementRow,
  GameRow,
  GameStatus,
  GenreRef,
  HltbInfo,
  LowInfo,
  Platform,
  PlaySession,
  PriceInfo,
  PricePoint,
  PurchaseRecord,
  UserDataPatch,
  WishlistRow
} from '@shared/types'
import { effectiveLow } from '@shared/analytics'

export const keyOf = (platform: Platform, gameId: string | number): string => `${platform}:${gameId}`

export function parseKey(key: string): { platform: Platform; gameId: string; appid: number | null } {
  const i = key.indexOf(':')
  const platform = key.slice(0, i) as Platform
  const gameId = key.slice(i + 1)
  return { platform, gameId, appid: platform === 'steam' ? Number(gameId) : null }
}

export const steamHeader = (appid: number): string =>
  `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`

export interface OwnedGameInput {
  gameId: string
  name: string
  playtimeMin: number
  playtime2wMin: number
  lastPlayed: number | null
  hasStats: boolean
}

export interface SteamAppInput {
  appid: number
  status: 'ok' | 'unavailable'
  type?: string | null
  name?: string | null
  nameKo?: string | null
  isFree?: boolean
  headerImage?: string | null
  genres?: GenreRef[]
  releaseDate?: string | null
}

export interface AchInput {
  apiname: string
  name: string
  description: string
  icon: string
  iconGray: string
  achieved: boolean
  unlockTime: number | null
}

type Row = Record<string, unknown>

const num = (v: unknown): number | null => (v == null ? null : Number(v))
const str = (v: unknown): string | null => (v == null ? null : String(v))

export class Repo {
  constructor(readonly db: Db) {}

  // ───────── 설정 / 메타 ─────────
  getSettingsMap(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const r of this.db.prepare('SELECT key, value FROM settings').all<Row>()) out[String(r.key)] = String(r.value)
    return out
  }
  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)').run(key, value)
  }
  getMeta(key: string): string | null {
    return str(this.db.prepare('SELECT value FROM meta WHERE key = ?').get<Row>(key)?.value)
  }
  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(key, value)
  }

  // ───────── 게임 목록 ─────────
  /** 보유 게임 갱신. 목록에 없는 게임은 owned=0 (환불 등) */
  upsertOwnedGames(platform: Platform, list: OwnedGameInput[], now = Date.now()): { added: string[] } {
    const added: string[] = []
    this.db.tx(() => {
      const exists = this.db.prepare('SELECT 1 AS x FROM games WHERE platform = ? AND game_id = ?')
      const ins = this.db.prepare(
        `INSERT INTO games(platform, game_id, name, playtime_min, playtime_2w_min, last_played, has_stats, owned, first_seen, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      const upd = this.db.prepare(
        `UPDATE games SET name = ?, playtime_min = ?, playtime_2w_min = ?, last_played = ?, has_stats = ?, owned = 1, updated_at = ?
         WHERE platform = ? AND game_id = ?`
      )
      const seen = new Set<string>()
      for (const g of list) {
        seen.add(g.gameId)
        if (exists.get(platform, g.gameId)) {
          upd.run(g.name, g.playtimeMin, g.playtime2wMin, g.lastPlayed, g.hasStats, now, platform, g.gameId)
        } else {
          ins.run(platform, g.gameId, g.name, g.playtimeMin, g.playtime2wMin, g.lastPlayed, g.hasStats, now, now)
          added.push(keyOf(platform, g.gameId))
        }
      }
      const all = this.db.prepare('SELECT game_id FROM games WHERE platform = ? AND owned = 1').all<Row>(platform)
      const off = this.db.prepare('UPDATE games SET owned = 0, updated_at = ? WHERE platform = ? AND game_id = ?')
      for (const r of all) if (!seen.has(String(r.game_id))) off.run(now, platform, String(r.game_id))
    })
    return { added }
  }

  ownedSteamAppids(): number[] {
    return this.db
      .prepare(`SELECT game_id FROM games WHERE platform = 'steam' AND owned = 1`)
      .all<Row>()
      .map((r) => Number(r.game_id))
  }

  steamGamesForAchievements(): { appid: number; playtimeMin: number; fetchedPlaytime: number | null }[] {
    return this.db
      .prepare(
        `SELECT g.game_id, g.playtime_min, s.playtime_at_fetch FROM games g
         LEFT JOIN steam_ach_summary s ON s.appid = CAST(g.game_id AS INTEGER)
         WHERE g.platform = 'steam' AND g.owned = 1 AND g.has_stats = 1`
      )
      .all<Row>()
      .map((r) => ({ appid: Number(r.game_id), playtimeMin: Number(r.playtime_min), fetchedPlaytime: num(r.playtime_at_fetch) }))
  }

  // ───────── Steam 상점 정보 ─────────
  upsertSteamApp(a: SteamAppInput, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO steam_app(appid, type, name, name_ko, is_free, header_image, genres, release_date, status, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        a.appid,
        a.type ?? null,
        a.name ?? null,
        a.nameKo ?? null,
        a.isFree ?? false,
        a.headerImage ?? null,
        JSON.stringify(a.genres ?? []),
        a.releaseDate ?? null,
        a.status,
        now
      )
  }

  /** 상세 정보가 없거나 오래된 appid */
  appidsNeedingDetails(appids: number[], maxAgeMs: number, now = Date.now()): number[] {
    const st = this.db.prepare('SELECT fetched_at, status FROM steam_app WHERE appid = ?')
    return appids.filter((id) => {
      const r = st.get<Row>(id)
      if (!r) return true
      const age = now - Number(r.fetched_at)
      // 판매 중단 게임은 자주 다시 볼 필요가 없다
      return age > (r.status === 'unavailable' ? maxAgeMs * 3 : maxAgeMs)
    })
  }

  getSteamApp(appid: number): { name: string | null; nameKo: string | null; headerImage: string | null; genres: GenreRef[]; isFree: boolean; status: string } | null {
    const r = this.db.prepare('SELECT * FROM steam_app WHERE appid = ?').get<Row>(appid)
    if (!r) return null
    return {
      name: str(r.name),
      nameKo: str(r.name_ko),
      headerImage: str(r.header_image),
      genres: JSON.parse(String(r.genres)) as GenreRef[],
      isFree: Boolean(r.is_free),
      status: String(r.status)
    }
  }

  // ───────── 가격 ─────────
  /** 현재 가격 저장. 직전 기록과 다르면 이력에 추가 */
  savePrice(appid: number, region: 'kr' | 'us', p: Omit<PriceInfo, 'fetchedAt'> | null, now = Date.now()): boolean {
    if (!p) {
      this.db.prepare('DELETE FROM steam_price WHERE appid = ? AND region = ?').run(appid, region)
      return false
    }
    this.db
      .prepare(
        `INSERT OR REPLACE INTO steam_price(appid, region, currency, initial, final, discount, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(appid, region, p.currency, p.initial, p.final, p.discount, now)
    const last = this.db
      .prepare(
        `SELECT initial, final, discount FROM steam_price_history WHERE appid = ? AND region = ? ORDER BY recorded_at DESC LIMIT 1`
      )
      .get<Row>(appid, region)
    if (!last || Number(last.final) !== p.final || Number(last.initial) !== p.initial) {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO steam_price_history(appid, region, initial, final, discount, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(appid, region, p.initial, p.final, p.discount, now)
      return true
    }
    return false
  }

  getPrice(appid: number, region: 'kr' | 'us'): PriceInfo | null {
    const r = this.db.prepare('SELECT * FROM steam_price WHERE appid = ? AND region = ?').get<Row>(appid, region)
    return r ? rowToPrice(r) : null
  }

  priceHistory(appid: number, region: 'kr' | 'us'): PricePoint[] {
    return this.db
      .prepare(
        `SELECT initial, final, discount, recorded_at FROM steam_price_history WHERE appid = ? AND region = ? ORDER BY recorded_at`
      )
      .all<Row>(appid, region)
      .map((r) => ({
        t: Number(r.recorded_at),
        initial: Number(r.initial),
        final: Number(r.final),
        discount: Number(r.discount),
        source: 'self' as const
      }))
  }

  saveLow(appid: number, region: 'kr' | 'us', low: { currency: string; amount: number; regular: number | null; cut: number; at: string | null } | null, now = Date.now()): void {
    if (!low) {
      this.db.prepare('DELETE FROM steam_low WHERE appid = ? AND region = ?').run(appid, region)
      return
    }
    this.db
      .prepare(
        `INSERT OR REPLACE INTO steam_low(appid, region, currency, amount, regular, cut, at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(appid, region, low.currency, low.amount, low.regular, low.cut, low.at, now)
  }

  getItadLow(appid: number, region: 'kr' | 'us'): LowInfo | null {
    const r = this.db.prepare('SELECT * FROM steam_low WHERE appid = ? AND region = ?').get<Row>(appid, region)
    return r ? rowToLow(r) : null
  }

  /** 프로그램이 기록한 가격 중 최저 */
  selfLow(appid: number, region: 'kr' | 'us'): LowInfo | null {
    const r = this.db
      .prepare(
        `SELECT initial, final, discount, recorded_at FROM steam_price_history WHERE appid = ? AND region = ? AND final > 0
         ORDER BY final ASC, recorded_at ASC LIMIT 1`
      )
      .get<Row>(appid, region)
    if (!r) return null
    return {
      amount: Number(r.final),
      regular: Number(r.initial),
      cut: Number(r.discount),
      date: new Date(Number(r.recorded_at)).toISOString(),
      source: 'self'
    }
  }

  effectiveLow(appid: number, region: 'kr' | 'us'): LowInfo | null {
    return effectiveLow(this.getItadLow(appid, region), this.getPrice(appid, region), this.selfLow(appid, region))
  }

  getItadId(appid: number): { itadId: string | null; fetchedAt: number } | null {
    const r = this.db.prepare('SELECT itad_id, fetched_at FROM itad_map WHERE appid = ?').get<Row>(appid)
    return r ? { itadId: str(r.itad_id), fetchedAt: Number(r.fetched_at) } : null
  }
  setItadId(appid: number, itadId: string | null, now = Date.now()): void {
    this.db.prepare('INSERT OR REPLACE INTO itad_map(appid, itad_id, fetched_at) VALUES (?, ?, ?)').run(appid, itadId, now)
  }

  // ───────── 도전과제 ─────────
  saveAchievements(appid: number, list: AchInput[], playtimeMin: number, now = Date.now()): void {
    this.db.tx(() => {
      const prevPct = new Map<string, number | null>()
      for (const r of this.db.prepare('SELECT apiname, global_pct FROM steam_ach WHERE appid = ?').all<Row>(appid))
        prevPct.set(String(r.apiname), num(r.global_pct))
      this.db.prepare('DELETE FROM steam_ach WHERE appid = ?').run(appid)
      const ins = this.db.prepare(
        `INSERT INTO steam_ach(appid, apiname, name, description, icon, icon_gray, achieved, unlock_time, global_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      let done = 0
      for (const a of list) {
        if (a.achieved) done++
        ins.run(appid, a.apiname, a.name, a.description, a.icon, a.iconGray, a.achieved, a.unlockTime, prevPct.get(a.apiname) ?? null)
      }
      this.db
        .prepare(
          `INSERT OR REPLACE INTO steam_ach_summary(appid, total, done, playtime_at_fetch, fetched_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run(appid, list.length, done, playtimeMin, now)
    })
  }

  markNoAchievements(appid: number, playtimeMin: number, now = Date.now()): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO steam_ach_summary(appid, total, done, playtime_at_fetch, fetched_at) VALUES (?, 0, 0, ?, ?)`)
      .run(appid, playtimeMin, now)
  }

  setGlobalPct(appid: number, pct: Map<string, number>): void {
    this.db.tx(() => {
      const up = this.db.prepare('UPDATE steam_ach SET global_pct = ? WHERE appid = ? AND apiname = ?')
      for (const [k, v] of pct) up.run(v, appid, k)
    })
  }

  achievements(appid: number): AchievementRow[] {
    return this.db
      .prepare('SELECT * FROM steam_ach WHERE appid = ? ORDER BY achieved DESC, unlock_time DESC, name')
      .all<Row>(appid)
      .map((r) => ({
        apiname: String(r.apiname),
        name: String(r.name ?? r.apiname),
        description: String(r.description ?? ''),
        icon: String(r.icon ?? ''),
        iconGray: String(r.icon_gray ?? ''),
        achieved: Boolean(r.achieved),
        unlockTime: num(r.unlock_time) || null,
        globalPct: num(r.global_pct)
      }))
  }

  recentUnlocks(sinceSec: number): { appid: number; apiname: string; name: string; icon: string; unlockTime: number }[] {
    return this.db
      .prepare(
        `SELECT appid, apiname, name, icon, unlock_time FROM steam_ach WHERE achieved = 1 AND unlock_time >= ? ORDER BY unlock_time DESC`
      )
      .all<Row>(sinceSec)
      .map((r) => ({
        appid: Number(r.appid),
        apiname: String(r.apiname),
        name: String(r.name ?? r.apiname),
        icon: String(r.icon ?? ''),
        unlockTime: Number(r.unlock_time)
      }))
  }

  // ───────── 사용자 데이터 ─────────
  ensureUserData(platform: Platform, gameId: string): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO user_data(platform, game_id, updated_at) VALUES (?, ?, ?)`)
      .run(platform, gameId, Date.now())
  }

  patchUserData(key: string, patch: UserDataPatch): void {
    const { platform, gameId } = parseKey(key)
    this.ensureUserData(platform, gameId)
    const sets: string[] = []
    const vals: unknown[] = []
    if (patch.status !== undefined) {
      sets.push('status = ?', 'status_auto = 0')
      vals.push(patch.status)
    }
    if (patch.excluded !== undefined) {
      sets.push('excluded = ?')
      vals.push(patch.excluded)
    }
    if (patch.purchasePrice !== undefined) {
      sets.push('purchase_price = ?', 'purchase_source = ?')
      vals.push(patch.purchasePrice, patch.purchasePrice == null ? null : 'manual')
    }
    if (patch.purchaseDate !== undefined) {
      sets.push('purchase_date = ?')
      vals.push(patch.purchaseDate)
    }
    if (patch.notes !== undefined) {
      sets.push('notes = ?')
      vals.push(patch.notes)
    }
    if (patch.rating !== undefined) {
      sets.push('rating = ?')
      vals.push(patch.rating)
    }
    if (patch.hltbMainManual !== undefined) {
      sets.push('hltb_main_manual = ?')
      vals.push(patch.hltbMainManual)
    }
    if (!sets.length) return
    sets.push('updated_at = ?')
    vals.push(Date.now())
    this.db.prepare(`UPDATE user_data SET ${sets.join(', ')} WHERE platform = ? AND game_id = ?`).run(...vals, platform, gameId)
  }

  /** 자동 상태 지정. 사용자가 직접 정한 상태(status_auto=0 이면서 none 아님)는 건드리지 않는다 */
  setAutoStatus(key: string, status: GameStatus): boolean {
    const { platform, gameId } = parseKey(key)
    this.ensureUserData(platform, gameId)
    const r = this.db.prepare('SELECT status, status_auto FROM user_data WHERE platform = ? AND game_id = ?').get<Row>(platform, gameId)
    if (!r) return false
    const manual = !r.status_auto && r.status !== 'none'
    if (manual || r.status === status) return false
    this.db
      .prepare('UPDATE user_data SET status = ?, status_auto = 1, updated_at = ? WHERE platform = ? AND game_id = ?')
      .run(status, Date.now(), platform, gameId)
    return true
  }

  /** 가져오기로 구매가/구매일 기록. 직접 입력한 값은 덮어쓰지 않는다 */
  setImportedPurchase(key: string, amount: number | null, date: string | null): boolean {
    const { platform, gameId } = parseKey(key)
    this.ensureUserData(platform, gameId)
    const r = this.db.prepare('SELECT purchase_source FROM user_data WHERE platform = ? AND game_id = ?').get<Row>(platform, gameId)
    if (r?.purchase_source === 'manual') return false
    this.db
      .prepare(
        `UPDATE user_data SET purchase_price = ?, purchase_date = COALESCE(?, purchase_date), purchase_source = 'history', updated_at = ?
         WHERE platform = ? AND game_id = ?`
      )
      .run(amount, date, Date.now(), platform, gameId)
    return true
  }

  setAcquiredDate(key: string, date: string): void {
    const { platform, gameId } = parseKey(key)
    this.ensureUserData(platform, gameId)
    this.db
      .prepare('UPDATE user_data SET acquired_date = ?, updated_at = ? WHERE platform = ? AND game_id = ?')
      .run(date, Date.now(), platform, gameId)
  }

  // ───────── HLTB ─────────
  saveHltb(key: string, h: { hltbId: number | null; matchedName: string | null; main: number | null; extra: number | null; complete: number | null }): void {
    const { platform, gameId } = parseKey(key)
    this.db
      .prepare(
        `INSERT OR REPLACE INTO hltb(platform, game_id, hltb_id, matched_name, main, extra, complete, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(platform, gameId, h.hltbId, h.matchedName, h.main, h.extra, h.complete, Date.now())
  }

  hltbFetchedKeys(): Set<string> {
    return new Set(
      this.db.prepare('SELECT platform, game_id FROM hltb').all<Row>().map((r) => keyOf(r.platform as Platform, String(r.game_id)))
    )
  }

  // ───────── 스냅샷 / 세션 ─────────
  saveSnapshot(date: string, rows: { platform: Platform; gameId: string; minutes: number }[]): number {
    let n = 0
    this.db.tx(() => {
      const last = this.db.prepare(
        'SELECT minutes FROM playtime_snapshots WHERE platform = ? AND game_id = ? AND date < ? ORDER BY date DESC LIMIT 1'
      )
      const ins = this.db.prepare('INSERT OR REPLACE INTO playtime_snapshots(platform, game_id, date, minutes) VALUES (?, ?, ?, ?)')
      for (const r of rows) {
        const prev = last.get<Row>(r.platform, r.gameId, date)
        // 값이 바뀌었거나 첫 기록일 때만 저장해서 DB를 작게 유지
        if (!prev || Number(prev.minutes) !== r.minutes) {
          ins.run(r.platform, r.gameId, date, r.minutes)
          n++
        }
      }
    })
    return n
  }

  snapshotsSince(date: string): { key: string; date: string; minutes: number }[] {
    return this.db
      .prepare('SELECT platform, game_id, date, minutes FROM playtime_snapshots WHERE date >= ? ORDER BY date')
      .all<Row>(date)
      .map((r) => ({ key: keyOf(r.platform as Platform, String(r.game_id)), date: String(r.date), minutes: Number(r.minutes) }))
  }

  /** 기준일 이전 마지막 스냅샷 (기간 시작 시점의 누적값) */
  snapshotBaseline(date: string): Map<string, number> {
    const m = new Map<string, number>()
    const rows = this.db
      .prepare(
        `SELECT platform, game_id, minutes FROM playtime_snapshots s
         WHERE date = (SELECT MAX(date) FROM playtime_snapshots t WHERE t.platform = s.platform AND t.game_id = s.game_id AND t.date < ?)`
      )
      .all<Row>(date)
    for (const r of rows) m.set(keyOf(r.platform as Platform, String(r.game_id)), Number(r.minutes))
    return m
  }

  snapshotCount(): number {
    return Number(this.db.prepare('SELECT COUNT(DISTINCT date) AS n FROM playtime_snapshots').get<Row>()?.n ?? 0)
  }

  playtimeSeries(key: string): { date: string; minutes: number }[] {
    const { platform, gameId } = parseKey(key)
    return this.db
      .prepare('SELECT date, minutes FROM playtime_snapshots WHERE platform = ? AND game_id = ? ORDER BY date')
      .all<Row>(platform, gameId)
      .map((r) => ({ date: String(r.date), minutes: Number(r.minutes) }))
  }

  startSession(key: string, name: string, at: number): number {
    const { platform, gameId } = parseKey(key)
    return this.db
      .prepare('INSERT INTO play_sessions(platform, game_id, name, started_at) VALUES (?, ?, ?, ?)')
      .run(platform, gameId, name, at).lastInsertRowid
  }

  endSession(id: number, at: number): void {
    this.db.prepare('UPDATE play_sessions SET ended_at = ? WHERE id = ?').run(at, id)
  }

  /** 비정상 종료 등으로 끝나지 않은 세션 정리 */
  closeDanglingSessions(at: number): void {
    this.db.prepare('UPDATE play_sessions SET ended_at = ? WHERE ended_at IS NULL').run(at)
  }

  sessions(opts: { key?: string; since?: number; limit?: number }): PlaySession[] {
    const where: string[] = []
    const vals: unknown[] = []
    if (opts.key) {
      const { platform, gameId } = parseKey(opts.key)
      where.push('platform = ? AND game_id = ?')
      vals.push(platform, gameId)
    }
    if (opts.since) {
      where.push('started_at >= ?')
      vals.push(opts.since)
    }
    const sql = `SELECT * FROM play_sessions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY started_at DESC LIMIT ?`
    return this.db
      .prepare(sql)
      .all<Row>(...vals, opts.limit ?? 200)
      .map((r) => ({
        id: Number(r.id),
        key: keyOf(r.platform as Platform, String(r.game_id)),
        name: String(r.name),
        startedAt: Number(r.started_at),
        endedAt: num(r.ended_at)
      }))
  }

  // ───────── 위시리스트 ─────────
  replaceWishlist(items: { appid: number; addedAt: number | null; priority: number }[], now = Date.now()): void {
    this.db.tx(() => {
      this.db.prepare('UPDATE wishlist SET active = 0').run()
      const st = this.db.prepare(
        `INSERT INTO wishlist(appid, added_at, priority, active, first_seen) VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(appid) DO UPDATE SET added_at = excluded.added_at, priority = excluded.priority, active = 1`
      )
      for (const w of items) st.run(w.appid, w.addedAt, w.priority, now)
    })
  }

  wishlistAppids(): number[] {
    return this.db.prepare('SELECT appid FROM wishlist WHERE active = 1').all<Row>().map((r) => Number(r.appid))
  }

  listWishlist(): WishlistRow[] {
    const rows = this.db.prepare('SELECT * FROM wishlist WHERE active = 1 ORDER BY priority, added_at DESC').all<Row>()
    return rows.map((r) => {
      const appid = Number(r.appid)
      const app = this.getSteamApp(appid)
      return {
        appid,
        key: keyOf('steam', appid),
        name: app?.nameKo || app?.name || `App ${appid}`,
        addedAt: num(r.added_at),
        priority: Number(r.priority),
        headerImage: app?.headerImage || steamHeader(appid),
        genres: app?.genres ?? [],
        priceKr: this.getPrice(appid, 'kr'),
        priceUs: this.getPrice(appid, 'us'),
        lowKr: this.effectiveLow(appid, 'kr'),
        lowUs: this.effectiveLow(appid, 'us'),
        detailsStatus: (app?.status as WishlistRow['detailsStatus']) ?? 'pending'
      }
    })
  }

  // ───────── 구매 내역 ─────────
  insertPurchase(p: { date: string | null; type: string; items: string[]; total: number | null; currency: string | null; refunded: boolean }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO purchases(date, type, items, total, currency, refunded, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(p.date, p.type, JSON.stringify(p.items), p.total, p.currency, p.refunded, Date.now())
  }

  purchases(): PurchaseRecord[] {
    return this.db
      .prepare('SELECT * FROM purchases ORDER BY date DESC, id DESC')
      .all<Row>()
      .map((r) => ({
        id: Number(r.id),
        date: str(r.date),
        type: String(r.type ?? ''),
        items: JSON.parse(String(r.items)) as string[],
        total: num(r.total),
        currency: str(r.currency),
        refunded: Boolean(r.refunded)
      }))
  }

  // ───────── 추천 후보 ─────────
  replaceRecoPool(list: { appid: number; name: string; genres: string[]; positive: number; negative: number }[], now = Date.now()): void {
    this.db.tx(() => {
      this.db.prepare('DELETE FROM reco_pool').run()
      const st = this.db.prepare('INSERT OR REPLACE INTO reco_pool(appid, name, genres, positive, negative, fetched_at) VALUES (?, ?, ?, ?, ?, ?)')
      for (const x of list) st.run(x.appid, x.name, JSON.stringify(x.genres), x.positive, x.negative, now)
    })
  }

  recoPool(): { appid: number; name: string; genres: string[]; positive: number; negative: number; fetchedAt: number }[] {
    return this.db
      .prepare('SELECT * FROM reco_pool')
      .all<Row>()
      .map((r) => ({
        appid: Number(r.appid),
        name: String(r.name),
        genres: JSON.parse(String(r.genres)) as string[],
        positive: Number(r.positive),
        negative: Number(r.negative),
        fetchedAt: Number(r.fetched_at)
      }))
  }

  // ───────── 화면용 게임 행 ─────────
  listGames(): GameRow[] {
    const games = this.db.prepare('SELECT * FROM games WHERE owned = 1 ORDER BY name COLLATE NOCASE').all<Row>()
    const userMap = new Map<string, Row>()
    for (const r of this.db.prepare('SELECT * FROM user_data').all<Row>()) userMap.set(keyOf(r.platform as Platform, String(r.game_id)), r)
    const hltbMap = new Map<string, Row>()
    for (const r of this.db.prepare('SELECT * FROM hltb').all<Row>()) hltbMap.set(keyOf(r.platform as Platform, String(r.game_id)), r)
    const appMap = new Map<number, Row>()
    for (const r of this.db.prepare('SELECT * FROM steam_app').all<Row>()) appMap.set(Number(r.appid), r)
    const priceMap = new Map<string, PriceInfo>()
    for (const r of this.db.prepare('SELECT * FROM steam_price').all<Row>()) priceMap.set(`${r.appid}:${r.region}`, rowToPrice(r))
    const itadLowMap = new Map<string, LowInfo>()
    for (const r of this.db.prepare('SELECT * FROM steam_low').all<Row>()) itadLowMap.set(`${r.appid}:${r.region}`, rowToLow(r))
    const selfLowMap = new Map<string, LowInfo>()
    for (const r of this.db
      .prepare(
        `SELECT h.appid, h.region, h.initial, h.final, h.discount, h.recorded_at FROM steam_price_history h
         JOIN (SELECT appid, region, MIN(final) AS mf FROM steam_price_history WHERE final > 0 GROUP BY appid, region) m
           ON m.appid = h.appid AND m.region = h.region AND m.mf = h.final`
      )
      .all<Row>()) {
      const k = `${r.appid}:${r.region}`
      if (selfLowMap.has(k)) continue
      selfLowMap.set(k, {
        amount: Number(r.final),
        regular: Number(r.initial),
        cut: Number(r.discount),
        date: new Date(Number(r.recorded_at)).toISOString(),
        source: 'self'
      })
    }
    const achMap = new Map<number, Row>()
    for (const r of this.db.prepare('SELECT * FROM steam_ach_summary').all<Row>()) achMap.set(Number(r.appid), r)
    const wish = new Set(this.wishlistAppids())

    return games.map((g) => {
      const platform = g.platform as Platform
      const gameId = String(g.game_id)
      const key = keyOf(platform, gameId)
      const appid = platform === 'steam' ? Number(gameId) : null
      const u = userMap.get(key)
      const app = appid != null ? appMap.get(appid) : undefined
      const pk = appid != null ? priceMap.get(`${appid}:kr`) ?? null : null
      const pu = appid != null ? priceMap.get(`${appid}:us`) ?? null : null
      const ach = appid != null ? achMap.get(appid) : undefined
      const h = hltbMap.get(key)
      const manualMain = num(u?.hltb_main_manual)
      let hltb: HltbInfo | null = null
      if (manualMain != null) {
        hltb = { main: manualMain, extra: num(h?.extra), complete: num(h?.complete), source: 'manual', hltbId: num(h?.hltb_id), matchedName: str(h?.matched_name) }
      } else if (h && (h.main != null || h.extra != null || h.complete != null)) {
        hltb = { main: num(h.main), extra: num(h.extra), complete: num(h.complete), source: 'hltb', hltbId: num(h.hltb_id), matchedName: str(h.matched_name) }
      }
      return {
        key,
        platform,
        gameId,
        appid,
        name: String(g.name),
        nameKo: str(app?.name_ko),
        playtimeMin: Number(g.playtime_min),
        playtime2wMin: Number(g.playtime_2w_min),
        lastPlayed: num(g.last_played) || null,
        headerImage: str(app?.header_image) || (appid != null ? steamHeader(appid) : ''),
        genres: app ? (JSON.parse(String(app.genres)) as GenreRef[]) : [],
        isFree: Boolean(app?.is_free),
        detailsStatus: (app?.status as GameRow['detailsStatus']) ?? 'pending',
        priceKr: pk,
        priceUs: pu,
        lowKr: appid != null ? effectiveLow(itadLowMap.get(`${appid}:kr`) ?? null, pk, selfLowMap.get(`${appid}:kr`) ?? null) : null,
        lowUs: appid != null ? effectiveLow(itadLowMap.get(`${appid}:us`) ?? null, pu, selfLowMap.get(`${appid}:us`) ?? null) : null,
        achTotal: ach ? Number(ach.total) : null,
        achDone: ach ? Number(ach.done) : null,
        status: ((u?.status as GameStatus) ?? 'none') as GameStatus,
        statusAuto: Boolean(u?.status_auto),
        excludedManual: Boolean(u?.excluded),
        purchasePrice: num(u?.purchase_price),
        purchaseDate: str(u?.purchase_date),
        purchaseSource: (str(u?.purchase_source) as GameRow['purchaseSource']) ?? null,
        acquiredDate: str(u?.acquired_date),
        notes: String(u?.notes ?? ''),
        rating: num(u?.rating),
        hltb,
        inWishlist: appid != null && wish.has(appid),
        firstSeen: Number(g.first_seen)
      }
    })
  }

  getGame(key: string): GameRow | null {
    return this.listGames().find((g) => g.key === key) ?? null
  }

  gameName(key: string): string | null {
    const { platform, gameId } = parseKey(key)
    return str(this.db.prepare('SELECT name FROM games WHERE platform = ? AND game_id = ?').get<Row>(platform, gameId)?.name)
  }
}

function rowToPrice(r: Row): PriceInfo {
  return {
    currency: String(r.currency),
    initial: Number(r.initial),
    final: Number(r.final),
    discount: Number(r.discount),
    fetchedAt: Number(r.fetched_at)
  }
}

function rowToLow(r: Row): LowInfo {
  return {
    amount: Number(r.amount),
    regular: num(r.regular),
    cut: Number(r.cut),
    date: str(r.at),
    source: 'itad'
  }
}

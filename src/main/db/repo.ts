import type { Db } from './driver'
import type {
  DlcOwnSource,
  ManualGameInput,
  TrophyCounts,
  AchievementRow,
  DlcRow,
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
  RareAchievement,
  ReviewInfo,
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
  /** Steam 이외 플랫폼에서 받은 추가 정보 */
  ext?: ExtGameInput
}

export interface ExtGameInput {
  image?: string | null
  device?: string | null
  achDone?: number | null
  achTotal?: number | null
  scoreDone?: number | null
  scoreTotal?: number | null
  trophies?: TrophyCounts | null
  playtimeKnown?: boolean
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
  dlc?: number[]
  parentAppid?: number | null
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
        if (g.ext) this.saveExt(platform, g.gameId, g.ext, false, now)
      }
      // 직접 추가한 게임은 목록에 없어도 그대로 둔다
      const all = this.db
        .prepare(
          `SELECT game_id FROM games g WHERE platform = ? AND owned = 1
           AND NOT EXISTS (SELECT 1 FROM ext_game e WHERE e.platform = g.platform AND e.game_id = g.game_id AND e.manual = 1)`
        )
        .all<Row>(platform)
      const off = this.db.prepare('UPDATE games SET owned = 0, updated_at = ? WHERE platform = ? AND game_id = ?')
      for (const r of all) if (!seen.has(String(r.game_id))) off.run(now, platform, String(r.game_id))
    })
    return { added }
  }

  saveExt(platform: Platform, gameId: string, e: ExtGameInput, manual: boolean, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ext_game(platform, game_id, image, device, ach_done, ach_total, score_done, score_total, trophies, playtime_known, manual, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        platform,
        gameId,
        e.image ?? null,
        e.device ?? null,
        e.achDone ?? null,
        e.achTotal ?? null,
        e.scoreDone ?? null,
        e.scoreTotal ?? null,
        e.trophies ? JSON.stringify(e.trophies) : null,
        e.playtimeKnown === false ? 0 : 1,
        manual ? 1 : 0,
        now
      )
  }

  /** 직접 추가 (Switch, 기타 런처, 디스크 게임 등) */
  addManualGame(input: ManualGameInput, now = Date.now()): string {
    const gameId = `m${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
    this.db.tx(() => {
      this.db
        .prepare(
          `INSERT INTO games(platform, game_id, name, playtime_min, playtime_2w_min, last_played, has_stats, owned, first_seen, updated_at)
           VALUES (?, ?, ?, ?, 0, NULL, 0, 1, ?, ?)`
        )
        .run(input.platform, gameId, input.name.trim(), Math.max(0, Math.round(input.playtimeMin)), now, now)
      this.saveExt(input.platform, gameId, { image: input.image, device: input.device }, true, now)
    })
    return keyOf(input.platform, gameId)
  }

  updateManualGame(key: string, input: Partial<Omit<ManualGameInput, 'platform'>>, now = Date.now()): void {
    const { platform, gameId } = parseKey(key)
    const ext = this.db.prepare('SELECT * FROM ext_game WHERE platform = ? AND game_id = ? AND manual = 1').get<Row>(platform, gameId)
    if (!ext) throw new Error('직접 추가한 게임만 고칠 수 있습니다.')
    this.db.tx(() => {
      if (input.name !== undefined || input.playtimeMin !== undefined) {
        const g = this.db.prepare('SELECT name, playtime_min FROM games WHERE platform = ? AND game_id = ?').get<Row>(platform, gameId)
        this.db
          .prepare('UPDATE games SET name = ?, playtime_min = ?, updated_at = ? WHERE platform = ? AND game_id = ?')
          .run(
            input.name?.trim() || String(g?.name ?? ''),
            input.playtimeMin !== undefined ? Math.max(0, Math.round(input.playtimeMin)) : Number(g?.playtime_min ?? 0),
            now,
            platform,
            gameId
          )
      }
      this.db
        .prepare('UPDATE ext_game SET image = ?, device = ?, updated_at = ? WHERE platform = ? AND game_id = ?')
        .run(
          input.image !== undefined ? input.image : str(ext.image),
          input.device !== undefined ? input.device : str(ext.device),
          now,
          platform,
          gameId
        )
    })
  }

  /** 플랫폼 연결을 끊을 때: 받아 온 게임만 목록에서 뺀다 (직접 입력한 구매가·메모는 남겨 다시 연결하면 돌아온다) */
  removePlatformGames(platform: Platform): number {
    let n = 0
    this.db.tx(() => {
      const rows = this.db
        .prepare(
          `SELECT game_id FROM games g WHERE platform = ?
           AND NOT EXISTS (SELECT 1 FROM ext_game e WHERE e.platform = g.platform AND e.game_id = g.game_id AND e.manual = 1)`
        )
        .all<Row>(platform)
      for (const r of rows) {
        this.db.prepare('DELETE FROM games WHERE platform = ? AND game_id = ?').run(platform, String(r.game_id))
        this.db.prepare('DELETE FROM ext_game WHERE platform = ? AND game_id = ?').run(platform, String(r.game_id))
        n++
      }
    })
    return n
  }

  deleteManualGame(key: string): void {
    const { platform, gameId } = parseKey(key)
    const ext = this.db.prepare('SELECT 1 AS x FROM ext_game WHERE platform = ? AND game_id = ? AND manual = 1').get<Row>(platform, gameId)
    if (!ext) throw new Error('직접 추가한 게임만 지울 수 있습니다.')
    this.db.tx(() => {
      for (const t of ['games', 'user_data', 'ext_game', 'playtime_snapshots', 'hltb', 'play_sessions']) {
        this.db.prepare(`DELETE FROM ${t} WHERE platform = ? AND game_id = ?`).run(platform, gameId)
      }
    })
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
        `INSERT OR REPLACE INTO steam_app(appid, type, name, name_ko, is_free, header_image, genres, release_date, status, fetched_at, dlc, parent_appid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        now,
        JSON.stringify(a.dlc ?? []),
        a.parentAppid ?? null
      )
    if (a.status === 'ok' && a.dlc) this.db.prepare('UPDATE steam_app SET dlc_checked_at = ? WHERE appid = ?').run(now, a.appid)
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
    const other = this.getItadLow(appid, region === 'kr' ? 'us' : 'kr')
    return effectiveLow(this.getItadLow(appid, region), this.getPrice(appid, region), this.selfLow(appid, region), other?.cut ?? null)
  }

  // ───────── DLC / 평가 / 목표가 ─────────
  /** 보유 게임들의 DLC appid 목록 (부모 appid 포함) */
  ownedGamesDlc(): { parent: number; dlc: number }[] {
    const out: { parent: number; dlc: number }[] = []
    const rows = this.db
      .prepare(
        `SELECT a.appid, a.dlc FROM steam_app a JOIN games g ON g.platform = 'steam' AND CAST(g.game_id AS INTEGER) = a.appid
         WHERE g.owned = 1 AND a.dlc IS NOT NULL AND a.dlc != '[]'`
      )
      .all<Row>()
    for (const r of rows) for (const d of JSON.parse(String(r.dlc)) as number[]) out.push({ parent: Number(r.appid), dlc: d })
    return out
  }

  /** DLC 목록을 아직 확인하지 않은 보유 게임 */
  ownedGamesUncheckedDlc(): number[] {
    return this.db
      .prepare(
        `SELECT CAST(g.game_id AS INTEGER) AS appid FROM games g
         LEFT JOIN steam_app a ON a.appid = CAST(g.game_id AS INTEGER)
         WHERE g.platform = 'steam' AND g.owned = 1 AND (a.appid IS NULL OR a.dlc_checked_at IS NULL)`
      )
      .all<Row>()
      .map((r) => Number(r.appid))
  }

  /** 게임의 DLC 목록 저장. 상점 상세 정보에서 받은 목록과 합친다 */
  setDlcList(parent: number, dlc: number[], now = Date.now()): void {
    const cur = this.db.prepare('SELECT dlc FROM steam_app WHERE appid = ?').get<Row>(parent)
    if (!cur) return
    const merged = [...new Set([...(JSON.parse(String(cur.dlc ?? '[]')) as number[]), ...dlc])]
    this.db.prepare('UPDATE steam_app SET dlc = ?, dlc_checked_at = ? WHERE appid = ?').run(JSON.stringify(merged), now, parent)
  }

  appidsWithoutApp(appids: number[]): number[] {
    const st = this.db.prepare('SELECT 1 AS x FROM steam_app WHERE appid = ?')
    return appids.filter((id) => !st.get(id))
  }

  /** GetItems 로 받은 DLC 기본 정보 저장 (상세 정보를 따로 받지 않는 DLC용) */
  saveDlcBasic(appid: number, parent: number, name: string | null, isFree: boolean, now = Date.now(), headerImage: string | null = null): void {
    const cur = this.db.prepare('SELECT status FROM steam_app WHERE appid = ?').get<Row>(appid)
    if (cur && cur.status === 'ok') {
      this.db
        .prepare('UPDATE steam_app SET name_ko = COALESCE(?, name_ko), parent_appid = ?, header_image = COALESCE(?, header_image) WHERE appid = ?')
        .run(name, parent, headerImage, appid)
      return
    }
    this.upsertSteamApp({ appid, status: 'ok', type: 'dlc', nameKo: name, isFree, parentAppid: parent, genres: [], headerImage }, now)
  }

  saveReview(appid: number, r: ReviewInfo, now = Date.now()): void {
    this.db
      .prepare('INSERT OR REPLACE INTO steam_reviews(appid, percent, count, label, fetched_at) VALUES (?, ?, ?, ?, ?)')
      .run(appid, r.percent, r.count, r.label, now)
  }

  appidsNeedingReviews(appids: number[], maxAgeMs: number, now = Date.now()): number[] {
    const st = this.db.prepare('SELECT fetched_at FROM steam_reviews WHERE appid = ?')
    return appids.filter((id) => {
      const r = st.get<Row>(id)
      return !r || now - Number(r.fetched_at) > maxAgeMs
    })
  }

  getReview(appid: number): ReviewInfo | null {
    const r = this.db.prepare('SELECT * FROM steam_reviews WHERE appid = ?').get<Row>(appid)
    return r && Number(r.count) > 0 ? { percent: num(r.percent), count: Number(r.count), label: str(r.label) } : null
  }

  setDlcOwned(appid: number, owned: boolean, source: DlcOwnSource): void {
    // 직접 해제한 DLC는 가져오기가 다시 보유로 바꾸지 않는다
    if (source !== 'manual') {
      const cur = this.db.prepare('SELECT owned, source FROM dlc_owned WHERE appid = ?').get<Row>(appid)
      if (cur && cur.source === 'manual') return
    }
    this.db
      .prepare('INSERT OR REPLACE INTO dlc_owned(appid, owned, source, updated_at) VALUES (?, ?, ?, ?)')
      .run(appid, owned, source, Date.now())
  }

  /**
   * 보유 앱 목록(게임 + DLC)으로 보유 DLC 를 맞춘다.
   *  - store: Steam 로그인으로 받은 전체 보유 목록 → 목록에 없어진 DLC(환불 등)는 보유 해제
   *  - installed: 설치 폴더에서 찾은 DLC → 보유로 표시만 한다
   * 직접 체크·해제한 DLC 는 건드리지 않는다.
   */
  applyOwnedApps(appids: Iterable<number>, source: 'store' | 'installed'): { owned: number; added: number; removed: number } {
    const have = new Set(appids)
    const cur = new Map<number, Row>()
    for (const r of this.db.prepare('SELECT * FROM dlc_owned').all<Row>()) cur.set(Number(r.appid), r)
    let owned = 0
    let added = 0
    let removed = 0
    this.db.tx(() => {
      for (const { dlc } of this.ownedGamesDlc()) {
        const c = cur.get(dlc)
        if (have.has(dlc)) {
          owned++
          if (c?.source === 'manual') continue
          if (!c?.owned) added++
          if (!c?.owned || (source === 'store' && c.source !== 'store')) this.setDlcOwned(dlc, true, source)
        } else if (source === 'store' && c?.owned && c.source !== 'manual') {
          this.setDlcOwned(dlc, false, 'store')
          removed++
        }
      }
    })
    return { owned, added, removed }
  }

  ownedDlcAppids(): number[] {
    return this.db.prepare('SELECT appid FROM dlc_owned WHERE owned = 1').all<Row>().map((r) => Number(r.appid))
  }

  setTargetPrice(appid: number, price: number | null): void {
    this.db
      .prepare(
        `INSERT INTO wish_user(appid, target_price) VALUES (?, ?)
         ON CONFLICT(appid) DO UPDATE SET target_price = excluded.target_price, notified_target_price = NULL`
      )
      .run(appid, price)
  }

  wishUser(appid: number): { target: number | null; notifiedTarget: number | null; notifiedLow: number | null } {
    const r = this.db.prepare('SELECT * FROM wish_user WHERE appid = ?').get<Row>(appid)
    return { target: num(r?.target_price), notifiedTarget: num(r?.notified_target_price), notifiedLow: num(r?.notified_low_price) }
  }

  markNotified(appid: number, kind: 'target' | 'low', price: number | null): void {
    this.db.prepare('INSERT OR IGNORE INTO wish_user(appid) VALUES (?)').run(appid)
    this.db
      .prepare(`UPDATE wish_user SET ${kind === 'target' ? 'notified_target_price' : 'notified_low_price'} = ? WHERE appid = ?`)
      .run(price, appid)
  }

  /** 전체 유저 달성률을 받을 게임 (달성한 도전과제가 있고, 30일 넘게 안 받은 게임) */
  appidsNeedingGlobalPct(maxAgeMs: number, now = Date.now()): number[] {
    return this.db
      .prepare(`SELECT appid FROM steam_ach_summary WHERE done > 0 AND (pct_fetched_at IS NULL OR pct_fetched_at < ?)`)
      .all<Row>(now - maxAgeMs)
      .map((r) => Number(r.appid))
  }

  markGlobalPctFetched(appid: number, now = Date.now()): void {
    this.db.prepare('UPDATE steam_ach_summary SET pct_fetched_at = ? WHERE appid = ?').run(now, appid)
  }

  rareAchievements(limit: number): RareAchievement[] {
    const names = new Map(this.listGamesLite().map((g) => [g.appid, g.name]))
    return this.db
      .prepare(
        `SELECT appid, apiname, name, description, icon, global_pct, unlock_time FROM steam_ach
         WHERE achieved = 1 AND global_pct IS NOT NULL ORDER BY global_pct ASC LIMIT ?`
      )
      .all<Row>(limit)
      .map((r) => ({
        key: keyOf('steam', Number(r.appid)),
        gameName: names.get(Number(r.appid)) ?? `App ${r.appid}`,
        apiname: String(r.apiname),
        name: String(r.name ?? r.apiname),
        description: String(r.description ?? ''),
        icon: String(r.icon ?? ''),
        globalPct: Number(r.global_pct),
        unlockTime: num(r.unlock_time) || null
      }))
  }

  /** 이름만 필요할 때 쓰는 가벼운 목록 */
  listGamesLite(): { key: string; appid: number | null; name: string }[] {
    return this.db
      .prepare(
        `SELECT g.platform, g.game_id, g.name, a.name_ko FROM games g
         LEFT JOIN steam_app a ON g.platform = 'steam' AND a.appid = CAST(g.game_id AS INTEGER) WHERE g.owned = 1`
      )
      .all<Row>()
      .map((r) => ({
        key: keyOf(r.platform as Platform, String(r.game_id)),
        appid: r.platform === 'steam' ? Number(r.game_id) : null,
        name: String(r.name_ko || r.name)
      }))
  }

  /** 보유 게임의 DLC 목록. parentKey 를 주면 그 게임 것만 */
  listDlcs(parentKey?: string): DlcRow[] {
    const pc = new PriceContext(this)
    const parents = new Map(this.listGamesLite().map((g) => [g.appid, g]))
    const users = new Map<number, Row>()
    for (const r of this.db.prepare(`SELECT * FROM user_data WHERE platform = 'steam'`).all<Row>()) users.set(Number(r.game_id), r)
    const owned = new Map<number, Row>()
    for (const r of this.db.prepare('SELECT * FROM dlc_owned').all<Row>()) owned.set(Number(r.appid), r)
    const wantParent = parentKey ? parseKey(parentKey).appid : null
    const out: DlcRow[] = []
    for (const { parent, dlc } of this.ownedGamesDlc()) {
      if (wantParent != null && parent !== wantParent) continue
      const p = parents.get(parent)
      if (!p) continue
      const app = this.getSteamApp(dlc)
      const u = users.get(dlc)
      const o = owned.get(dlc)
      const { priceKr, priceUs, lowKr, lowUs } = pc.prices(dlc)
      out.push({
        appid: dlc,
        key: keyOf('steam', dlc),
        parentKey: p.key,
        parentName: p.name,
        name: app?.nameKo || app?.name || `DLC ${dlc}`,
        headerImage: app?.headerImage || steamHeader(dlc),
        priceKr,
        priceUs,
        lowKr,
        lowUs,
        review: pc.review(dlc),
        isFree: Boolean(app?.isFree),
        owned: Boolean(o?.owned),
        ownedSource: (str(o?.source) as DlcRow['ownedSource']) ?? null,
        purchasePrice: num(u?.purchase_price),
        purchaseDate: str(u?.purchase_date)
      })
    }
    return out
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

  /**
   * 지출 기록 초기화.
   *  imported: 구매 내역에서 가져온 값만 / all: 직접 입력한 값까지 모두 (+ 가져온 구매 내역, 라이선스 획득일)
   */
  resetPurchases(scope: 'imported' | 'all'): number {
    return this.db.tx(() => {
      const now = Date.now()
      const where = scope === 'imported' ? `purchase_source = 'history'` : `purchase_price IS NOT NULL OR purchase_date IS NOT NULL OR acquired_date IS NOT NULL`
      const n = Number(this.db.prepare(`SELECT COUNT(*) AS n FROM user_data WHERE ${where}`).get<Row>()?.n ?? 0)
      if (scope === 'imported') {
        this.db
          .prepare(`UPDATE user_data SET purchase_price = NULL, purchase_date = NULL, purchase_source = NULL, updated_at = ? WHERE purchase_source = 'history'`)
          .run(now)
      } else {
        this.db
          .prepare(`UPDATE user_data SET purchase_price = NULL, purchase_date = NULL, purchase_source = NULL, acquired_date = NULL, updated_at = ?`)
          .run(now)
      }
      this.db.prepare('DELETE FROM purchases').run()
      return n
    })
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
    const pc = new PriceContext(this)
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
        ...pc.prices(appid),
        detailsStatus: (app?.status as WishlistRow['detailsStatus']) ?? 'pending',
        review: pc.review(appid),
        targetPrice: this.wishUser(appid).target
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
    const pc = new PriceContext(this)
    const dlcCount = new Map<number, number>()
    for (const d of this.ownedGamesDlc()) dlcCount.set(d.parent, (dlcCount.get(d.parent) ?? 0) + 1)
    const dlcOwned = new Map<number, number>()
    const ownedSet = new Set(this.ownedDlcAppids())
    for (const d of this.ownedGamesDlc()) if (ownedSet.has(d.dlc)) dlcOwned.set(d.parent, (dlcOwned.get(d.parent) ?? 0) + 1)
    const achMap = new Map<number, Row>()
    for (const r of this.db.prepare('SELECT * FROM steam_ach_summary').all<Row>()) achMap.set(Number(r.appid), r)
    const wish = new Set(this.wishlistAppids())
    const extMap = new Map<string, Row>()
    for (const r of this.db.prepare('SELECT * FROM ext_game').all<Row>()) extMap.set(keyOf(r.platform as Platform, String(r.game_id)), r)

    return games.map((g) => {
      const platform = g.platform as Platform
      const gameId = String(g.game_id)
      const key = keyOf(platform, gameId)
      const appid = platform === 'steam' ? Number(gameId) : null
      const u = userMap.get(key)
      const app = appid != null ? appMap.get(appid) : undefined
      const pr = appid != null ? pc.prices(appid) : { priceKr: null, priceUs: null, lowKr: null, lowUs: null }
      const ach = appid != null ? achMap.get(appid) : undefined
      const h = hltbMap.get(key)
      const ext = extMap.get(key)
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
        headerImage: str(app?.header_image) || (appid != null ? steamHeader(appid) : str(ext?.image) ?? ''),
        genres: app ? (JSON.parse(String(app.genres)) as GenreRef[]) : [],
        isFree: Boolean(app?.is_free),
        detailsStatus: (app?.status as GameRow['detailsStatus']) ?? 'pending',
        ...pr,
        achTotal: ach ? Number(ach.total) : num(ext?.ach_total),
        achDone: ach ? Number(ach.done) : num(ext?.ach_done),
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
        firstSeen: Number(g.first_seen),
        review: appid != null ? pc.review(appid) : null,
        dlcCount: appid != null ? dlcCount.get(appid) ?? 0 : 0,
        dlcOwned: appid != null ? dlcOwned.get(appid) ?? 0 : 0,
        device: str(ext?.device),
        playtimeKnown: ext ? Boolean(ext.playtime_known) : true,
        manual: Boolean(ext?.manual),
        trophies: ext?.trophies ? (JSON.parse(String(ext.trophies)) as TrophyCounts) : null,
        gamerscore: ext && ext.score_total != null ? { done: Number(ext.score_done ?? 0), total: Number(ext.score_total) } : null
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

/** 여러 게임의 가격·최저가·평가를 한 번에 계산하기 위해 테이블을 미리 읽어 둔다 */
class PriceContext {
  private price = new Map<string, PriceInfo>()
  private itad = new Map<string, LowInfo>()
  private self = new Map<string, LowInfo>()
  private reviews = new Map<number, ReviewInfo>()

  constructor(repo: Repo) {
    const db = repo.db
    for (const r of db.prepare('SELECT * FROM steam_price').all<Row>()) this.price.set(`${r.appid}:${r.region}`, rowToPrice(r))
    for (const r of db.prepare('SELECT * FROM steam_low').all<Row>()) this.itad.set(`${r.appid}:${r.region}`, rowToLow(r))
    for (const r of db
      .prepare(
        `SELECT h.appid, h.region, h.initial, h.final, h.discount, h.recorded_at FROM steam_price_history h
         JOIN (SELECT appid, region, MIN(final) AS mf FROM steam_price_history WHERE final > 0 GROUP BY appid, region) m
           ON m.appid = h.appid AND m.region = h.region AND m.mf = h.final`
      )
      .all<Row>()) {
      const k = `${r.appid}:${r.region}`
      if (this.self.has(k)) continue
      this.self.set(k, {
        amount: Number(r.final),
        regular: Number(r.initial),
        cut: Number(r.discount),
        date: new Date(Number(r.recorded_at)).toISOString(),
        source: 'self'
      })
    }
    for (const r of db.prepare('SELECT * FROM steam_reviews WHERE count > 0').all<Row>())
      this.reviews.set(Number(r.appid), { percent: num(r.percent), count: Number(r.count), label: str(r.label) })
  }

  prices(appid: number) {
    const priceKr = this.price.get(`${appid}:kr`) ?? null
    const priceUs = this.price.get(`${appid}:us`) ?? null
    const itadKr = this.itad.get(`${appid}:kr`) ?? null
    const itadUs = this.itad.get(`${appid}:us`) ?? null
    return {
      priceKr,
      priceUs,
      lowKr: effectiveLow(itadKr, priceKr, this.self.get(`${appid}:kr`) ?? null, itadUs?.cut ?? null),
      lowUs: effectiveLow(itadUs, priceUs, this.self.get(`${appid}:us`) ?? null, itadKr?.cut ?? null)
    }
  }

  review(appid: number): ReviewInfo | null {
    return this.reviews.get(appid) ?? null
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

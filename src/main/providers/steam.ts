// Steam Web API + Steam 상점 API
import type { GenreRef, PriceInfo, ProfileInfo, ReviewInfo, Settings, StoreSearchResult } from '@shared/types'
import type { AchInput, OwnedGameInput, SteamAppInput } from '../db/repo'
import { HttpError, limiters, request } from '../util/http'
import type { PlatformProvider, ProviderContext } from './types'

const API = 'https://api.steampowered.com'
const STORE = 'https://store.steampowered.com'

/** Steam 가격은 모든 통화가 ×100 단위. KRW는 원 단위로, USD는 센트 그대로 */
export function toMinor(currency: string, steamValue: number): number {
  return currency === 'KRW' || currency === 'JPY' ? Math.round(steamValue / 100) : Math.round(steamValue)
}

type PriceOverview = { currency: string; initial: number; final: number; discount_percent: number }

export function parsePriceOverview(po: PriceOverview | undefined | null): Omit<PriceInfo, 'fetchedAt'> | null {
  if (!po || typeof po.final !== 'number') return null
  return {
    currency: po.currency,
    initial: toMinor(po.currency, po.initial || po.final),
    final: toMinor(po.currency, po.final),
    discount: po.discount_percent || 0
  }
}

function q(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')
}

export class SteamError extends Error {}

// ───────── 계정 ─────────

/** 17자리 ID, 프로필 URL, 커스텀 URL 이름 모두 받아서 SteamID64 로 변환 */
export async function resolveSteamId(input: string, key: string): Promise<string> {
  const s = input.trim()
  if (/^\d{17}$/.test(s)) return s
  const prof = s.match(/steamcommunity\.com\/profiles\/(\d{17})/)
  if (prof) return prof[1]
  const vanity = s.match(/steamcommunity\.com\/id\/([^/?#]+)/)?.[1] ?? s
  if (!key) throw new SteamError('Steam API 키를 먼저 입력해 주세요.')
  const r = await request<{ response: { success: number; steamid?: string } }>(
    `${API}/ISteamUser/ResolveVanityURL/v1/?${q({ key, vanityurl: vanity })}`,
    { limiter: limiters.steamApi }
  )
  if (r?.response?.success !== 1 || !r.response.steamid) throw new SteamError('해당 Steam 계정을 찾을 수 없습니다.')
  return r.response.steamid
}

interface PlayerSummary {
  steamid: string
  personaname: string
  avatarfull: string
  profileurl: string
  gameid?: string
  gameextrainfo?: string
  communityvisibilitystate?: number
}

export async function getPlayerSummary(key: string, steamId: string, signal?: AbortSignal): Promise<PlayerSummary | null> {
  const r = await request<{ response: { players: PlayerSummary[] } }>(
    `${API}/ISteamUser/GetPlayerSummaries/v2/?${q({ key, steamids: steamId })}`,
    { limiter: limiters.steamApi, signal }
  )
  return r?.response?.players?.[0] ?? null
}

export function toProfile(p: PlayerSummary): ProfileInfo {
  return { steamId: p.steamid, personaName: p.personaname, avatar: p.avatarfull, profileUrl: p.profileurl }
}

// ───────── 보유 게임 ─────────

interface OwnedGame {
  appid: number
  name?: string
  playtime_forever: number
  playtime_2weeks?: number
  rtime_last_played?: number
  has_community_visible_stats?: boolean
}

export async function getOwnedGames(key: string, steamId: string, signal?: AbortSignal): Promise<OwnedGameInput[]> {
  const r = await request<{ response: { game_count?: number; games?: OwnedGame[] } }>(
    `${API}/IPlayerService/GetOwnedGames/v1/?${q({
      key,
      steamid: steamId,
      include_appinfo: 1,
      include_played_free_games: 1,
      include_free_sub: 0,
      skip_unvetted_apps: 0,
      format: 'json'
    })}`,
    { limiter: limiters.steamApi, signal, timeoutMs: 60_000 }
  )
  if (!r?.response || r.response.game_count === undefined) {
    throw new SteamError(
      '게임 목록을 받지 못했습니다. Steam 프로필의 "게임 세부 정보"가 공개로 되어 있는지 확인해 주세요.'
    )
  }
  return (r.response.games ?? []).map((g) => ({
    gameId: String(g.appid),
    name: g.name || `App ${g.appid}`,
    playtimeMin: g.playtime_forever ?? 0,
    playtime2wMin: g.playtime_2weeks ?? 0,
    lastPlayed: g.rtime_last_played || null,
    hasStats: Boolean(g.has_community_visible_stats)
  }))
}

// ───────── 도전과제 ─────────

interface SchemaAch {
  name: string
  displayName?: string
  description?: string
  icon?: string
  icongray?: string
}

export async function getAchievements(key: string, steamId: string, appid: number, signal?: AbortSignal): Promise<AchInput[] | null> {
  let player: { apiname: string; achieved: number; unlocktime: number; name?: string; description?: string }[]
  try {
    const r = await request<{
      playerstats: { success: boolean; achievements?: typeof player }
    }>(`${API}/ISteamUserStats/GetPlayerAchievements/v1/?${q({ key, steamid: steamId, appid, l: 'koreana' })}`, {
      limiter: limiters.steamApi,
      signal,
      retries: 1
    })
    if (!r?.playerstats?.success || !r.playerstats.achievements) return null
    player = r.playerstats.achievements
  } catch (e) {
    // 도전과제가 없는 게임은 400을 돌려준다
    if (e instanceof HttpError && (e.status === 400 || e.status === 403)) return null
    throw e
  }
  let schema = new Map<string, SchemaAch>()
  try {
    const s = await request<{ game?: { availableGameStats?: { achievements?: SchemaAch[] } } }>(
      `${API}/ISteamUserStats/GetSchemaForGame/v2/?${q({ key, appid, l: 'koreana' })}`,
      { limiter: limiters.steamApi, signal, retries: 1 }
    )
    schema = new Map((s?.game?.availableGameStats?.achievements ?? []).map((a) => [a.name, a]))
  } catch {
    // 아이콘이 없어도 진행
  }
  return player.map((a) => {
    const sc = schema.get(a.apiname)
    return {
      apiname: a.apiname,
      name: a.name || sc?.displayName || a.apiname,
      description: a.description || sc?.description || '',
      icon: sc?.icon ?? '',
      iconGray: sc?.icongray ?? '',
      achieved: a.achieved === 1,
      unlockTime: a.unlocktime > 0 ? a.unlocktime : null
    }
  })
}

export async function getGlobalAchievementPct(appid: number): Promise<Map<string, number>> {
  const r = await request<{ achievementpercentages?: { achievements?: { name: string; percent: number | string }[] } }>(
    `${API}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?${q({ gameid: appid })}`,
    { limiter: limiters.steamApi, retries: 1 }
  )
  return new Map((r?.achievementpercentages?.achievements ?? []).map((a) => [a.name, Number(a.percent)]))
}

// ───────── 상점 정보 / 가격 ─────────

interface AppDetailsData {
  type?: string
  name?: string
  is_free?: boolean
  header_image?: string
  genres?: { id: string; description: string }[]
  release_date?: { date?: string }
  price_overview?: PriceOverview
  dlc?: number[]
  fullgame?: { appid?: string | number }
}

/** 상세 정보 (한국 상점, 한국어). 한국 가격도 함께 돌려준다 */
export async function getAppDetails(
  appid: number,
  signal?: AbortSignal
): Promise<{ app: SteamAppInput; priceKr: Omit<PriceInfo, 'fetchedAt'> | null }> {
  const r = await request<Record<string, { success: boolean; data?: AppDetailsData }>>(
    `${STORE}/api/appdetails?${q({ appids: appid, cc: 'kr', l: 'koreana' })}`,
    { limiter: limiters.steamStore, signal }
  )
  const entry = r?.[String(appid)]
  if (!entry?.success || !entry.data) {
    return { app: { appid, status: 'unavailable' }, priceKr: null }
  }
  const d = entry.data
  const genres: GenreRef[] = (d.genres ?? []).map((g) => ({ id: String(g.id), name: g.description }))
  return {
    app: {
      appid,
      status: 'ok',
      type: d.type ?? null,
      nameKo: d.name ?? null,
      isFree: Boolean(d.is_free),
      headerImage: d.header_image ?? null,
      genres,
      releaseDate: d.release_date?.date ?? null,
      dlc: (d.dlc ?? []).map(Number).filter((x) => Number.isFinite(x)),
      parentAppid: d.fullgame?.appid != null ? Number(d.fullgame.appid) : null
    },
    priceKr: parsePriceOverview(d.price_overview)
  }
}

/** 여러 게임의 가격을 한 번에 조회 (price_overview 필터 사용 시 일괄 조회 가능) */
export async function getPricesBatch(
  appids: number[],
  cc: 'kr' | 'us',
  signal?: AbortSignal
): Promise<Map<number, Omit<PriceInfo, 'fetchedAt'> | null>> {
  const out = new Map<number, Omit<PriceInfo, 'fetchedAt'> | null>()
  if (!appids.length) return out
  const r = await request<Record<string, { success: boolean; data?: { price_overview?: PriceOverview } | [] }>>(
    `${STORE}/api/appdetails?appids=${appids.join(',')}&${q({ cc, filters: 'price_overview' })}`,
    { limiter: limiters.steamStore, signal }
  )
  for (const id of appids) {
    const e = r?.[String(id)]
    if (!e?.success || !e.data || Array.isArray(e.data)) {
      out.set(id, null)
      continue
    }
    out.set(id, parsePriceOverview(e.data.price_overview))
  }
  return out
}

export async function storeSearch(term: string): Promise<StoreSearchResult[]> {
  const r = await request<{
    items?: { type: string; name: string; id: number; tiny_image?: string; price?: { currency: string; initial: number; final: number } }[]
  }>(`${STORE}/api/storesearch/?${q({ term, l: 'koreana', cc: 'KR' })}`, { limiter: limiters.steamStore })
  return (r?.items ?? [])
    .filter((x) => x.type === 'app')
    .map((x) => {
      let priceKr: PriceInfo | null = null
      if (x.price) {
        const initial = toMinor(x.price.currency, x.price.initial)
        const final = toMinor(x.price.currency, x.price.final)
        priceKr = {
          currency: x.price.currency,
          initial,
          final,
          discount: initial > 0 ? Math.round((1 - final / initial) * 100) : 0,
          fetchedAt: Date.now()
        }
      }
      return { appid: x.id, name: x.name, image: x.tiny_image ?? '', priceKr }
    })
}

// ───────── 이름·평가 일괄 조회 (IStoreBrowseService/GetItems, 최대 200개씩) ─────────

export interface StoreItemInfo {
  appid: number
  name: string | null
  isFree: boolean
  parentAppid: number | null
  review: ReviewInfo | null
}

export async function getStoreItems(appids: number[], signal?: AbortSignal): Promise<Map<number, StoreItemInfo>> {
  const out = new Map<number, StoreItemInfo>()
  for (let i = 0; i < appids.length; i += 200) {
    const part = appids.slice(i, i + 200)
    const input = {
      ids: part.map((appid) => ({ appid })),
      context: { language: 'koreana', country_code: 'KR', steam_realm: 1 },
      data_request: { include_basic_info: true, include_reviews: true }
    }
    const r = await request<{
      response?: {
        store_items?: {
          id?: number
          appid?: number
          success?: number
          name?: string
          is_free?: boolean
          related_items?: { parent_appid?: number }
          reviews?: { summary_filtered?: { review_count?: number; percent_positive?: number; review_score_label?: string } }
        }[]
      }
    }>(`${API}/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`, {
      limiter: limiters.steamApi,
      signal,
      timeoutMs: 30_000
    })
    for (const it of r?.response?.store_items ?? []) {
      const appid = Number(it.appid ?? it.id)
      if (!appid || it.success !== 1) continue
      const sum = it.reviews?.summary_filtered
      out.set(appid, {
        appid,
        name: it.name ?? null,
        isFree: Boolean(it.is_free),
        parentAppid: it.related_items?.parent_appid ?? null,
        review:
          sum && (sum.review_count ?? 0) > 0
            ? { percent: sum.percent_positive ?? null, count: sum.review_count ?? 0, label: sum.review_score_label ?? null }
            : null
      })
    }
  }
  return out
}

/** 한 게임의 평가 (GetItems가 실패했을 때 대비) */
export async function getAppReview(appid: number): Promise<ReviewInfo | null> {
  const r = await request<{ query_summary?: { total_positive?: number; total_reviews?: number; review_score_desc?: string } }>(
    `${STORE}/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0&l=koreana`,
    { limiter: limiters.steamStore, retries: 1 }
  )
  const q = r?.query_summary
  if (!q || !q.total_reviews) return null
  return { percent: Math.round(((q.total_positive ?? 0) / q.total_reviews) * 100), count: q.total_reviews, label: q.review_score_desc ?? null }
}

// ───────── DLC 목록 ─────────

/** 보유 게임들의 DLC 목록 한 번에 (IStoreBrowseService/GetDLCForApps). parent appid → DLC appid[] */
export async function getDlcForOwnedGames(key: string, steamId: string, appids: number[], signal?: AbortSignal): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>()
  const add = (parent: number, dlc: number) => {
    if (!parent || !dlc) return
    const list = out.get(parent) ?? []
    if (!list.includes(dlc)) list.push(dlc)
    out.set(parent, list)
  }
  type Resp = { response?: { dlc_data?: { appid?: number; parentappid?: number }[] } }
  const call = async (ids: number[] | null) => {
    const input: Record<string, unknown> = { context: { language: 'koreana', country_code: 'KR', steam_realm: 1 }, steamid: steamId }
    if (ids) input.appids = ids.map((appid) => ({ appid }))
    const r = await request<Resp>(`${API}/IStoreBrowseService/GetDLCForApps/v1/?key=${encodeURIComponent(key)}&input_json=${encodeURIComponent(JSON.stringify(input))}`, {
      limiter: limiters.steamApi,
      signal,
      timeoutMs: 60_000,
      retries: 1
    })
    for (const d of r?.response?.dlc_data ?? []) add(Number(d.parentappid), Number(d.appid))
  }
  // 1) 계정 기준으로 한 번에
  await call(null)
  // 2) 비어 있으면 게임 목록을 넘겨서 다시
  if (!out.size && appids.length) for (let i = 0; i < appids.length; i += 100) await call(appids.slice(i, i + 100))
  return out
}

/** 지정한 게임들의 DLC 목록 (IStoreBrowseService/GetDLCForAppsSolr) */
export async function getDlcForApps(key: string, appids: number[], signal?: AbortSignal): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>()
  for (let i = 0; i < appids.length; i += 100) {
    const input = { appids: appids.slice(i, i + 100), context: { language: 'koreana', country_code: 'KR', steam_realm: 1 }, count: 2000 }
    const r = await request<{ response?: { dlc_lists?: { parent_appid?: number; dlc_appids?: number[] }[] } }>(
      `${API}/IStoreBrowseService/GetDLCForAppsSolr/v1/?key=${encodeURIComponent(key)}&input_json=${encodeURIComponent(JSON.stringify(input))}`,
      { limiter: limiters.steamApi, signal, timeoutMs: 60_000, retries: 1 }
    )
    for (const l of r?.response?.dlc_lists ?? []) if (l.parent_appid) out.set(Number(l.parent_appid), (l.dlc_appids ?? []).map(Number))
  }
  return out
}

// ───────── 위시리스트 ─────────

export async function getWishlist(
  key: string,
  steamId: string,
  signal?: AbortSignal
): Promise<{ appid: number; addedAt: number | null; priority: number }[]> {
  const r = await request<{ response?: { items?: { appid: number; priority?: number; date_added?: number }[] } }>(
    `${API}/IWishlistService/GetWishlist/v1/?${q({ key, steamid: steamId })}`,
    { limiter: limiters.steamApi, signal }
  )
  return (r?.response?.items ?? []).map((w) => ({
    appid: w.appid,
    addedAt: w.date_added ? w.date_added * 1000 : null,
    priority: w.priority ?? 0
  }))
}

// ───────── 어댑터 ─────────

export const steamProvider: PlatformProvider = {
  platform: 'steam',
  displayName: 'Steam',
  isConfigured: (s: Settings) => Boolean(s.steamApiKey && s.steamId),
  fetchOwnedGames: (ctx: ProviderContext) => getOwnedGames(ctx.settings.steamApiKey, ctx.settings.steamId, ctx.signal)
}

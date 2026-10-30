// PlayStation Network (비공식 API: PlayStation 앱이 쓰는 것과 같은 주소)
// 로그인: 프로그램 안 Sony 로그인 창 → NPSSO 쿠키 → 인증 코드 → 토큰. 갱신 토큰만 암호화해 저장한다(약 2달 유효).
//  - 플레이한 게임과 플레이타임: gamelist/v2 (PS4·PS5)
//  - 트로피: trophy/v1 trophyTitles (PS3·Vita 포함)
import { titleKey } from '@shared/analytics'
import type { Settings, TrophyCounts } from '@shared/types'
import type { OwnedGameInput } from '../db/repo'
import { HttpError, rawFetch, RateLimiter, request } from '../util/http'
import type { PlatformProvider, ProviderContext } from './types'

const AUTH = 'https://ca.account.sony.com/api/authz/v3/oauth'
const API = 'https://m.np.playstation.com/api'
// PlayStation 앱의 공개 클라이언트 정보 (psn-api 등 공개 라이브러리와 같은 값)
const CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891'
const BASIC = 'Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A='
const REDIRECT = 'com.scee.psxandroid.scecompcall://redirect'
const SCOPE = 'psn:mobile.v2.core psn:clientapp'

export const SSO_COOKIE_URL = 'https://ca.account.sony.com/api/v1/ssocookie'
const limiter = new RateLimiter(250)

export interface PsnTokens {
  accessToken: string
  refreshToken: string
}

/** NPSSO → 인증 코드 (응답의 Location 에 담겨 온다) */
export async function codeFromNpsso(npsso: string): Promise<string> {
  const qs = new URLSearchParams({ access_type: 'offline', client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE })
  const r = await rawFetch(`${AUTH}/authorize?${qs}`, { headers: { Cookie: `npsso=${npsso}` }, redirect: 'manual' })
  const loc = r.headers.get('location') ?? ''
  const code = loc.includes('?') ? new URLSearchParams(loc.slice(loc.indexOf('?') + 1)).get('code') : null
  if (!code) throw new Error('PlayStation 인증 코드를 받지 못했습니다. 다시 로그인해 주세요.')
  return code
}

async function token(form: Record<string, string>): Promise<PsnTokens> {
  const r = await request<{ access_token?: string; refresh_token?: string }>(`${AUTH}/token`, {
    method: 'POST',
    form,
    headers: { Authorization: BASIC },
    limiter,
    retries: 1
  })
  if (!r?.access_token) throw new Error('PlayStation 토큰을 받지 못했습니다.')
  return { accessToken: r.access_token, refreshToken: r.refresh_token ?? form.refresh_token ?? '' }
}

export function tokensFromCode(code: string): Promise<PsnTokens> {
  return token({ code, redirect_uri: REDIRECT, grant_type: 'authorization_code', token_format: 'jwt' })
}

export async function refreshTokens(refreshToken: string): Promise<PsnTokens> {
  try {
    return await token({ refresh_token: refreshToken, grant_type: 'refresh_token', token_format: 'jwt', scope: SCOPE })
  } catch (e) {
    if (e instanceof HttpError && (e.status === 400 || e.status === 401)) {
      throw new Error('PlayStation 로그인이 만료되었습니다. 설정 → 다른 플랫폼에서 다시 로그인해 주세요.')
    }
    throw e
  }
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}`, 'Accept-Language': 'ko-KR' })

export async function getOnlineId(accessToken: string): Promise<string | null> {
  try {
    const r = await request<{ profile?: { onlineId?: string } }>(
      'https://us-prof.np.community.playstation.net/userProfile/v1/users/me/profile2?fields=onlineId',
      { headers: auth(accessToken), limiter, retries: 1 }
    )
    return r?.profile?.onlineId ?? null
  } catch {
    return null
  }
}

/** ISO 8601 기간(PT12H34M56S, P1DT2H)을 분으로 */
export function isoDurationMinutes(s: string | null | undefined): number {
  if (!s) return 0
  const m = s.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/)
  if (!m) return 0
  const [, d, h, min, sec] = m
  return Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(min ?? 0) + Math.floor(Number(sec ?? 0) / 60)
}

interface GameListTitle {
  titleId: string
  name: string
  localizedName?: string
  imageUrl?: string
  localizedImageUrl?: string
  category?: string
  playDuration?: string
  lastPlayedDateTime?: string
}

interface TrophyTitle {
  npCommunicationId: string
  trophyTitleName: string
  trophyTitleIconUrl?: string
  trophyTitlePlatform?: string
  definedTrophies?: Partial<TrophyCounts>
  earnedTrophies?: Partial<TrophyCounts>
  lastUpdatedDateTime?: string
}

const sum = (t?: Partial<TrophyCounts>) => (t ? (t.platinum ?? 0) + (t.gold ?? 0) + (t.silver ?? 0) + (t.bronze ?? 0) : 0)
const sec = (iso?: string) => (iso ? Math.floor(Date.parse(iso) / 1000) || null : null)

export async function fetchPsnGames(accessToken: string, signal?: AbortSignal): Promise<OwnedGameInput[]> {
  const titles: GameListTitle[] = []
  for (let offset = 0; offset < 5000; ) {
    const r = await request<{ titles?: GameListTitle[]; nextOffset?: number; totalItemCount?: number }>(
      `${API}/gamelist/v2/users/me/titles?categories=ps4_game,ps5_native_game&limit=200&offset=${offset}`,
      { headers: auth(accessToken), limiter, signal }
    )
    const page = r?.titles ?? []
    titles.push(...page)
    if (!page.length || r?.nextOffset == null || r.nextOffset <= offset) break
    offset = r.nextOffset
  }
  const trophies: TrophyTitle[] = []
  for (let offset = 0; offset < 10000; ) {
    const r = await request<{ trophyTitles?: TrophyTitle[]; nextOffset?: number }>(
      `${API}/trophy/v1/users/me/trophyTitles?limit=800&offset=${offset}`,
      { headers: auth(accessToken), limiter, signal }
    )
    const page = r?.trophyTitles ?? []
    trophies.push(...page)
    if (!page.length || r?.nextOffset == null || r.nextOffset <= offset) break
    offset = r.nextOffset
  }

  const byName = new Map<string, TrophyTitle>()
  for (const t of trophies) if (!byName.has(titleKey(t.trophyTitleName))) byName.set(titleKey(t.trophyTitleName), t)
  const usedTrophy = new Set<string>()
  const out = new Map<string, OwnedGameInput>()

  for (const t of titles) {
    const name = t.localizedName || t.name
    const tr = byName.get(titleKey(name)) ?? byName.get(titleKey(t.name))
    if (tr) usedTrophy.add(tr.npCommunicationId)
    const device = t.category === 'ps5_native_game' ? 'PS5' : t.category === 'ps4_game' ? 'PS4' : null
    // 같은 게임의 PS4·PS5 판이 따로 오면 플레이타임을 합친다
    const prev = out.get(t.titleId)
    const minutes = isoDurationMinutes(t.playDuration) + (prev?.playtimeMin ?? 0)
    out.set(t.titleId, {
      gameId: t.titleId,
      name,
      playtimeMin: minutes,
      playtime2wMin: 0,
      lastPlayed: sec(t.lastPlayedDateTime),
      hasStats: Boolean(tr),
      ext: {
        image: t.localizedImageUrl || t.imageUrl || tr?.trophyTitleIconUrl || null,
        device,
        achDone: tr ? sum(tr.earnedTrophies) : null,
        achTotal: tr ? sum(tr.definedTrophies) : null,
        trophies: tr ? { platinum: 0, gold: 0, silver: 0, bronze: 0, ...tr.earnedTrophies } : null,
        playtimeKnown: true
      }
    })
  }
  // 플레이 기록이 없는 트로피 목록 (PS3, Vita, 오래된 PS4 게임)
  for (const tr of trophies) {
    if (usedTrophy.has(tr.npCommunicationId)) continue
    out.set(tr.npCommunicationId, {
      gameId: tr.npCommunicationId,
      name: tr.trophyTitleName,
      playtimeMin: 0,
      playtime2wMin: 0,
      lastPlayed: sec(tr.lastUpdatedDateTime),
      hasStats: true,
      ext: {
        image: tr.trophyTitleIconUrl ?? null,
        device: tr.trophyTitlePlatform?.split(',')[0]?.replace('PSVITA', 'PS Vita') ?? null,
        achDone: sum(tr.earnedTrophies),
        achTotal: sum(tr.definedTrophies),
        trophies: { platinum: 0, gold: 0, silver: 0, bronze: 0, ...tr.earnedTrophies },
        playtimeKnown: false
      }
    })
  }
  return [...out.values()]
}

export const psnProvider: PlatformProvider = {
  platform: 'psn',
  displayName: 'PlayStation',
  isConfigured: (s: Settings) => Boolean(s.psnRefreshToken),
  async fetchOwnedGames(ctx: ProviderContext) {
    const t = await refreshTokens(ctx.settings.psnRefreshToken)
    // 갱신 토큰이 바뀌면 저장해 둔다
    if (t.refreshToken && t.refreshToken !== ctx.settings.psnRefreshToken) ctx.saveSettings?.({ psnRefreshToken: t.refreshToken })
    return fetchPsnGames(t.accessToken, ctx.signal)
  }
}

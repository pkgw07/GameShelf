// Nintendo Switch·Switch 2 플레이 기록 (비공식: 닌텐도 공식 "Nintendo Store" 앱이 쓰는 API)
// 로그인: 프로그램 안 닌텐도 계정 창 → "이 사람을 선택" → session_token(약 2년 유효, 암호화 저장) → 15분짜리 접근 토큰.
// 받는 것: 한 번이라도 실행한 게임의 총 플레이 시간, 처음·마지막 플레이 날짜, 최근 1주일 날짜별 기록.
import { createHash, randomBytes } from 'node:crypto'
import type { Settings } from '@shared/types'
import type { OwnedGameInput } from '../db/repo'
import { HttpError, RateLimiter, request } from '../util/http'
import type { PlatformProvider, ProviderContext } from './types'

const ACCOUNTS = 'https://accounts.nintendo.com/connect/1.0.0'
const CLIENT_ID = '5c38e31cd085304b'
export const NINTENDO_REDIRECT = `npf${CLIENT_ID}://auth`
const SCOPE = 'openid user user.mii user.email user.links[].id'
const PLAY_HISTORY = 'https://app-api.znej.nintendo.com/api/v2.0/users/me/play_histories'
const limiter = new RateLimiter(400)

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export interface NintendoLoginRequest {
  url: string
  verifier: string
  state: string
}

/** 로그인 주소 (PKCE) */
export function nintendoAuthUrl(): NintendoLoginRequest {
  const verifier = b64url(randomBytes(32))
  const state = b64url(randomBytes(24))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const qs = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: NINTENDO_REDIRECT,
    scope: SCOPE,
    response_type: 'session_token_code',
    session_token_code_challenge: challenge,
    session_token_code_challenge_method: 'S256',
    state
  })
  return { url: `${ACCOUNTS}/authorize?${qs}`, verifier, state }
}

/** "이 사람을 선택" 링크(npf…://auth#session_token_code=…&state=…)에서 코드 꺼내기 */
export function parseNintendoRedirect(link: string, state: string): string | null {
  if (!link.startsWith(`${NINTENDO_REDIRECT}#`)) return null
  const p = new URLSearchParams(link.slice(link.indexOf('#') + 1))
  if (p.get('state') !== state) throw new Error('닌텐도 로그인 확인값이 맞지 않습니다. 다시 시도해 주세요.')
  return p.get('session_token_code')
}

export async function nintendoSessionToken(code: string, verifier: string): Promise<string> {
  const r = await request<{ session_token?: string }>(`${ACCOUNTS}/api/session_token`, {
    method: 'POST',
    form: { client_id: CLIENT_ID, session_token_code: code, session_token_code_verifier: verifier },
    limiter,
    retries: 1
  })
  if (!r?.session_token) throw new Error('닌텐도 로그인 토큰을 받지 못했습니다.')
  return r.session_token
}

let cached: { session: string; access: string; until: number } | null = null

export async function nintendoAccess(sessionToken: string): Promise<string> {
  if (cached && cached.session === sessionToken && Date.now() < cached.until) return cached.access
  try {
    const r = await request<{ access_token?: string; expires_in?: number }>(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      body: { client_id: CLIENT_ID, session_token: sessionToken, grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer-session-token' },
      limiter,
      retries: 1
    })
    if (!r?.access_token) throw new Error('닌텐도 접근 토큰을 받지 못했습니다.')
    cached = { session: sessionToken, access: r.access_token, until: Date.now() + Math.max(60, (r.expires_in ?? 900) - 60) * 1000 }
    return r.access_token
  } catch (e) {
    if (e instanceof HttpError && (e.status === 400 || e.status === 401)) {
      throw new Error('닌텐도 로그인이 만료되었습니다. 설정 → 다른 플랫폼에서 다시 로그인해 주세요.')
    }
    throw e
  }
}

export async function nintendoNickname(access: string): Promise<string | null> {
  try {
    const r = await request<{ nickname?: string }>('https://api.accounts.nintendo.com/2.0.0/users/me', {
      headers: { Authorization: `Bearer ${access}` },
      limiter,
      retries: 1
    })
    return r?.nickname ?? null
  } catch {
    return null
  }
}

interface PlayHistory {
  titleId: string
  titleName: string
  imageUrl?: string
  platform?: string
  deviceType?: string
  firstPlayedAt?: string
  lastPlayedAt?: string
  totalPlayedMinutes?: number
}

interface RecentDay {
  playedDate?: string
  dailyPlayHistories?: { titleId: string; totalPlayedMinutes?: number }[]
}

export function nintendoDevice(h: Pick<PlayHistory, 'platform' | 'deviceType'>): string {
  const d = `${h.platform ?? ''} ${h.deviceType ?? ''}`.toUpperCase()
  return /SWITCH\s*2|OUNCE|BEE|NX2/.test(d) ? 'Switch 2' : 'Switch'
}

const sec = (iso?: string) => (iso ? Math.floor(Date.parse(iso) / 1000) || null : null)

export async function fetchNintendoGames(access: string, signal?: AbortSignal): Promise<OwnedGameInput[]> {
  const r = await request<{ playHistories?: PlayHistory[]; recentPlayHistories?: RecentDay[] }>(PLAY_HISTORY, {
    headers: { Authorization: `Bearer ${access}`, Accept: 'application/json', 'gentry-locale': 'ko-KR' },
    limiter,
    signal
  })
  // 최근 1주일 날짜별 기록 → 게임별 최근 플레이 시간
  const recent = new Map<string, number>()
  for (const day of r?.recentPlayHistories ?? []) {
    for (const d of day.dailyPlayHistories ?? []) recent.set(d.titleId, (recent.get(d.titleId) ?? 0) + (d.totalPlayedMinutes ?? 0))
  }
  return (r?.playHistories ?? [])
    .filter((h) => h.titleId && h.titleName)
    .map((h) => ({
      gameId: h.titleId,
      name: h.titleName,
      playtimeMin: Math.max(0, Math.round(h.totalPlayedMinutes ?? 0)),
      playtime2wMin: recent.get(h.titleId) ?? 0,
      lastPlayed: sec(h.lastPlayedAt),
      hasStats: false,
      ext: { image: h.imageUrl ?? null, device: nintendoDevice(h), playtimeKnown: true }
    }))
}

export const nintendoProvider: PlatformProvider = {
  platform: 'switch',
  displayName: 'Nintendo',
  isConfigured: (s: Settings) => Boolean(s.nintendoSessionToken),
  async fetchOwnedGames(ctx: ProviderContext) {
    return fetchNintendoGames(await nintendoAccess(ctx.settings.nintendoSessionToken), ctx.signal)
  }
}

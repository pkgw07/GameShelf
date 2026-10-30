// Xbox (OpenXBL: xbl.io 에서 Xbox 계정으로 로그인하면 무료 API 키를 받을 수 있다)
// 플레이한 게임 목록, 도전과제, 게이머스코어, 마지막 플레이 시각. Xbox 는 플레이타임을 주지 않는다.
import type { Settings } from '@shared/types'
import type { OwnedGameInput } from '../db/repo'
import { HttpError, RateLimiter, request } from '../util/http'
import type { PlatformProvider, ProviderContext } from './types'

const API = 'https://xbl.io/api/v2'
const limiter = new RateLimiter(500)

const headers = (key: string) => ({ 'X-Authorization': key, Accept: 'application/json', 'Accept-Language': 'ko-KR' })

function wrap(e: unknown): Error {
  if (e instanceof HttpError && (e.status === 401 || e.status === 403)) return new Error('OpenXBL API 키가 올바르지 않거나 만료되었습니다.')
  return e as Error
}

/** 키 확인 + 게이머태그 */
export async function xblAccount(key: string): Promise<string> {
  try {
    const r = await request<{ profileUsers?: { id?: string; settings?: { id: string; value: string }[] }[] }>(`${API}/account`, {
      headers: headers(key),
      limiter,
      retries: 1
    })
    const u = r?.profileUsers?.[0]
    if (!u) throw new Error('Xbox 계정 정보를 받지 못했습니다.')
    return u.settings?.find((x) => x.id === 'Gamertag')?.value ?? u.settings?.find((x) => x.id === 'ModernGamertag')?.value ?? u.id ?? 'Xbox'
  } catch (e) {
    throw wrap(e)
  }
}

interface XblTitle {
  titleId: string
  name: string
  type?: string
  devices?: string[]
  displayImage?: string
  achievement?: { currentAchievements?: number; totalAchievements?: number; currentGamerscore?: number; totalGamerscore?: number }
  titleHistory?: { lastTimePlayed?: string }
}

const DEVICE: Record<string, string> = { XboxSeries: 'Xbox Series', XboxOne: 'Xbox One', Xbox360: 'Xbox 360', PC: 'PC', Win32: 'PC' }

export async function fetchXboxGames(key: string, signal?: AbortSignal): Promise<OwnedGameInput[]> {
  let r: { titles?: XblTitle[] } | null
  try {
    r = await request<{ titles?: XblTitle[] }>(`${API}/achievements`, { headers: headers(key), limiter, signal, timeoutMs: 40_000 })
  } catch (e) {
    throw wrap(e)
  }
  return (r?.titles ?? [])
    .filter((t) => !t.type || t.type === 'Game')
    .map((t) => {
      const a = t.achievement ?? {}
      const dev = (t.devices ?? []).map((d) => DEVICE[d]).find(Boolean) ?? null
      const last = t.titleHistory?.lastTimePlayed ? Math.floor(Date.parse(t.titleHistory.lastTimePlayed) / 1000) || null : null
      return {
        gameId: String(t.titleId),
        name: t.name,
        playtimeMin: 0,
        playtime2wMin: 0,
        lastPlayed: last,
        hasStats: (a.totalAchievements ?? 0) > 0,
        ext: {
          image: t.displayImage ?? null,
          device: dev,
          achDone: a.totalAchievements ? (a.currentAchievements ?? 0) : null,
          achTotal: a.totalAchievements || null,
          scoreDone: a.totalGamerscore ? (a.currentGamerscore ?? 0) : null,
          scoreTotal: a.totalGamerscore || null,
          playtimeKnown: false
        }
      }
    })
}

export const xboxProvider: PlatformProvider = {
  platform: 'xbox',
  displayName: 'Xbox',
  isConfigured: (s: Settings) => Boolean(s.xblApiKey),
  fetchOwnedGames: (ctx: ProviderContext) => fetchXboxGames(ctx.settings.xblApiKey, ctx.signal)
}

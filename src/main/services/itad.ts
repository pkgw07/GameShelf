// IsThereAnyDeal API: Steam 스토어 기준 역대 최저가와 가격 이력
// 문서: https://docs.isthereanydeal.com/
import type { PricePoint } from '@shared/types'
import { chunk, limiters, request } from '../util/http'

const BASE = 'https://api.isthereanydeal.com'
export const ITAD_STEAM_SHOP = 61

const ZERO_DECIMAL = new Set(['KRW', 'JPY'])

export function amountToMinor(currency: string, amount: number): number {
  return ZERO_DECIMAL.has(currency) ? Math.round(amount) : Math.round(amount * 100)
}

export const regionCountry = (r: 'kr' | 'us') => (r === 'kr' ? 'KR' : 'US')
export const regionCurrency = (r: 'kr' | 'us') => (r === 'kr' ? 'KRW' : 'USD')

type Money = { amount: number; amountInt?: number; currency: string }

/** Steam appid → ITAD 게임 ID */
export async function lookupSteamIds(key: string, appids: number[], signal?: AbortSignal): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>()
  for (const part of chunk(appids, 200)) {
    const r = await request<Record<string, string | null>>(`${BASE}/lookup/id/shop/${ITAD_STEAM_SHOP}/v1?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      body: part.map((id) => `app/${id}`),
      limiter: limiters.itad,
      signal
    })
    for (const id of part) out.set(id, r?.[`app/${id}`] ?? null)
  }
  return out
}

export interface StoreLow {
  currency: string
  amount: number
  regular: number | null
  cut: number
  at: string | null
}

/** Steam 스토어의 역대 최저가. 해당 지역 통화가 아니면 제외 */
export async function steamStoreLows(
  key: string,
  itadIds: string[],
  region: 'kr' | 'us',
  signal?: AbortSignal
): Promise<Map<string, StoreLow>> {
  const out = new Map<string, StoreLow>()
  const want = regionCurrency(region)
  for (const part of chunk(itadIds, 200)) {
    const r = await request<
      { id: string; lows: { shop: { id: number }; price: Money; regular?: Money; cut: number; timestamp?: string }[] }[]
    >(`${BASE}/games/storelow/v2?key=${encodeURIComponent(key)}&country=${regionCountry(region)}&shops=${ITAD_STEAM_SHOP}`, {
      method: 'POST',
      body: part,
      limiter: limiters.itad,
      signal
    })
    for (const g of r ?? []) {
      const low = g.lows?.find((l) => l.shop?.id === ITAD_STEAM_SHOP)
      if (!low || low.price.currency !== want) continue
      out.set(g.id, {
        currency: low.price.currency,
        amount: amountToMinor(low.price.currency, low.price.amount),
        regular: low.regular ? amountToMinor(low.regular.currency, low.regular.amount) : null,
        cut: low.cut ?? 0,
        at: low.timestamp ?? null
      })
    }
  }
  return out
}

/** Steam 스토어 가격 변동 이력 (전체 기간) */
export async function steamHistory(key: string, itadId: string, region: 'kr' | 'us'): Promise<PricePoint[]> {
  const r = await request<{ timestamp: string; shop: { id: number }; deal: { price: Money; regular: Money; cut: number } }[]>(
    `${BASE}/games/history/v2?key=${encodeURIComponent(key)}&id=${encodeURIComponent(itadId)}&country=${regionCountry(region)}&shops=${ITAD_STEAM_SHOP}&since=${encodeURIComponent('2008-01-01T00:00:00Z')}`,
    { limiter: limiters.itad, timeoutMs: 30_000 }
  )
  const want = regionCurrency(region)
  return (r ?? [])
    .filter((x) => x.shop?.id === ITAD_STEAM_SHOP && x.deal?.price?.currency === want)
    .map((x) => ({
      t: Date.parse(x.timestamp),
      final: amountToMinor(want, x.deal.price.amount),
      initial: amountToMinor(want, x.deal.regular?.amount ?? x.deal.price.amount),
      discount: x.deal.cut ?? 0,
      source: 'itad' as const
    }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t)
}

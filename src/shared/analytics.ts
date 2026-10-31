// 통계·돈 계산 (순수 함수). 화면과 테스트에서 함께 사용한다.
import type { GameRow, GenreWeight, LowInfo, PriceInfo, PricePoint, RecoReason, Settings } from './types'
import { WEAK_GENRES, genreName } from './genres'

export const DAY_MS = 86_400_000

export function isUnplayed(
  g: Pick<GameRow, 'playtimeMin'> & Partial<Pick<GameRow, 'playtimeKnown' | 'achDone' | 'lastPlayed'>>,
  unplayedMinutes: number
): boolean {
  // 플레이타임을 모르는 플랫폼(Xbox): 실행 기록도 도전과제도 없을 때만 안 한 게임
  if (g.playtimeKnown === false) return !g.lastPlayed && !g.achDone
  return g.playtimeMin < Math.max(0, unplayedMinutes)
}

export type ExcludeReason = 'manual' | 'free' | 'giveaway' | 'unplayed' | 'genre'

/**
 * 무료 배포로 받은 것으로 보이는 게임: 유료 게임인데 역대 최저가가 0원이고, 돈을 내고 산 기록이 없음.
 * (정가로 샀는데 나중에 무료 배포된 게임은 구매가를 넣으면 빠지지 않는다)
 */
export function isGiveaway(g: Pick<GameRow, 'isFree' | 'lowKr' | 'lowUs' | 'purchasePrice'>): boolean {
  if (g.isFree || (g.purchasePrice ?? 0) > 0) return false
  return g.lowKr?.amount === 0 || (g.lowKr == null && g.lowUs?.amount === 0)
}

/** 통계에서 빠지는 이유. 빠지지 않으면 null */
export function excludeReason(
  g: GameRow,
  s: Pick<Settings, 'excludeFree' | 'excludeUnplayed' | 'excludedGenres' | 'unplayedMinutes'> & Partial<Pick<Settings, 'excludeGiveaway'>>
): ExcludeReason | null {
  if (g.excludedManual) return 'manual'
  if (s.excludeFree && g.isFree) return 'free'
  if (s.excludeGiveaway && isGiveaway(g)) return 'giveaway'
  if (s.excludeUnplayed && isUnplayed(g, s.unplayedMinutes)) return 'unplayed'
  if (s.excludedGenres.length && g.genres.some((x) => s.excludedGenres.includes(x.id))) return 'genre'
  return null
}

export const EXCLUDE_LABELS: Record<ExcludeReason, string> = {
  manual: '직접 제외',
  free: '무료 게임',
  giveaway: '무료 배포로 받은 게임',
  unplayed: '안 한 게임',
  genre: '제외 장르'
}

/** 할인율로 계산한 가격. Steam은 원화는 원 단위, 달러는 센트 내림으로 계산한다 */
export function priceAtCut(currency: string, regular: number, cut: number): number {
  const v = regular * (1 - cut / 100)
  return currency === 'USD' ? Math.floor(v + 1e-6) : Math.round(v)
}

/**
 * Steam 역대 최저가 = 역대 최대 할인율로 팔렸던 가격.
 * 현재 할인 여부와 상관없이 같은 값을 보여 준다.
 *  - itad: 이 지역의 IsThereAnyDeal 기록 (가장 정확)
 *  - selfMin: 프로그램이 기록한 가격 중 최저
 *  - current: 지금 가격 (지금이 역대 최대 할인이면 이것이 최저가)
 *  - otherCut: 다른 지역(미국)에서 기록된 최대 할인율. 이 지역 기록이 없을 때 정가에 적용해 추정
 */
export function effectiveLow(
  itad: LowInfo | null,
  current: PriceInfo | null,
  selfMin: LowInfo | null,
  otherCut: number | null = null
): LowInfo | null {
  const regular = current?.initial ?? itad?.regular ?? selfMin?.regular ?? null
  const actual: LowInfo[] = []
  if (itad) actual.push(itad)
  if (selfMin) actual.push(selfMin)
  if (current && current.final > 0) {
    actual.push({
      amount: current.final,
      regular: current.initial,
      cut: current.discount,
      date: new Date(current.fetchedAt).toISOString(),
      source: 'self'
    })
  }
  let best: LowInfo | null = actual.length ? actual.reduce((a, b) => (b.amount < a.amount ? b : a)) : null
  // 이 지역 기록이 없으면 다른 지역의 최대 할인율로 추정
  if (!itad && otherCut && otherCut > 0 && regular && regular > 0) {
    const est = priceAtCut(current?.currency ?? 'KRW', regular, otherCut)
    if (!best || est < best.amount) best = { amount: est, regular, cut: otherCut, date: null, source: 'estimate' }
  }
  if (!best) return null
  // 표시용 할인율은 정가 대비로 다시 계산 (기록마다 정가가 달랐을 수 있음)
  const cut = regular && regular > 0 ? Math.max(0, Math.round((1 - best.amount / regular) * 100)) : best.cut
  return { ...best, regular: regular ?? best.regular, cut }
}

export interface MoneyTotals {
  games: number
  regularKr: number
  currentKr: number
  lowKr: number
  regularUs: number
  currentUs: number
  lowUs: number
  pricedKr: number
  pricedUs: number
  lowCountKr: number
  spent: number
  spentCount: number
  /** 구매가가 있는 게임의 (정가 - 구매가) 합 */
  saved: number
  savedBase: number
  onSale: number
}

export type PricedItem = Pick<GameRow, 'priceKr' | 'priceUs' | 'lowKr' | 'lowUs' | 'purchasePrice'>

export function moneyTotals(games: PricedItem[]): MoneyTotals {
  const t: MoneyTotals = {
    games: games.length,
    regularKr: 0,
    currentKr: 0,
    lowKr: 0,
    regularUs: 0,
    currentUs: 0,
    lowUs: 0,
    pricedKr: 0,
    pricedUs: 0,
    lowCountKr: 0,
    spent: 0,
    spentCount: 0,
    saved: 0,
    savedBase: 0,
    onSale: 0
  }
  for (const g of games) {
    if (g.priceKr) {
      t.regularKr += g.priceKr.initial
      t.currentKr += g.priceKr.final
      t.pricedKr++
      if (g.priceKr.discount > 0) t.onSale++
    }
    if (g.lowKr) {
      t.lowKr += g.lowKr.amount
      t.lowCountKr++
    } else if (g.priceKr) {
      t.lowKr += g.priceKr.final
    }
    if (g.priceUs) {
      t.regularUs += g.priceUs.initial
      t.currentUs += g.priceUs.final
      t.pricedUs++
    }
    if (g.lowUs) t.lowUs += g.lowUs.amount
    else if (g.priceUs) t.lowUs += g.priceUs.final
    if (g.purchasePrice != null) {
      t.spent += g.purchasePrice
      t.spentCount++
      if (g.priceKr) {
        t.saved += g.priceKr.initial - g.purchasePrice
        t.savedBase += g.priceKr.initial
      }
    }
  }
  return t
}

/** 시간당 비용 (원/시간). 구매가가 없거나 플레이 1시간 미만이면 null */
export function costPerHour(g: GameRow, minHours = 1): number | null {
  if (g.purchasePrice == null) return null
  const h = g.playtimeMin / 60
  if (h < minHours) return null
  return g.purchasePrice / h
}

export type TimingGrade = 'best' | 'good' | 'fair' | 'pricey' | 'unknown'

export const TIMING_LABELS: Record<TimingGrade, string> = {
  best: '최저가 수준',
  good: '잘 샀어요',
  fair: '보통',
  pricey: '비싸게 샀어요',
  unknown: '판단 불가'
}

/** 구매 타이밍: 구매가를 역대 최저가와 정가 사이 어디쯤인지로 평가 */
export function purchaseTiming(g: GameRow): { grade: TimingGrade; ratio: number | null } {
  if (g.purchasePrice == null || !g.lowKr) return { grade: 'unknown', ratio: null }
  const low = g.lowKr.amount
  const reg = g.priceKr?.initial ?? g.lowKr.regular ?? null
  if (g.purchasePrice <= low * 1.05) return { grade: 'best', ratio: 0 }
  if (!reg || reg <= low) return { grade: 'fair', ratio: null }
  const ratio = Math.min(1.5, Math.max(0, (g.purchasePrice - low) / (reg - low)))
  if (ratio <= 0.35) return { grade: 'good', ratio }
  if (ratio <= 0.75) return { grade: 'fair', ratio }
  return { grade: 'pricey', ratio }
}

export function spendBy(games: { purchasePrice: number | null; purchaseDate: string | null; acquiredDate?: string | null }[], unit: 'year' | 'month'): { label: string; amount: number; count: number }[] {
  const m = new Map<string, { amount: number; count: number }>()
  for (const g of games) {
    const date = g.purchaseDate ?? g.acquiredDate
    if (g.purchasePrice == null || !date) continue
    const label = unit === 'year' ? date.slice(0, 4) : date.slice(0, 7)
    const cur = m.get(label) ?? { amount: 0, count: 0 }
    cur.amount += g.purchasePrice
    cur.count++
    m.set(label, cur)
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, v]) => ({ label, ...v }))
}

/** 엔딩까지 남은 시간 (시간). 메인 스토리 기준 */
export function hltbRemaining(g: GameRow): { total: number; remaining: number; progress: number } | null {
  const main = g.hltb?.main
  if (!main || main <= 0) return null
  const played = g.playtimeMin / 60
  return { total: main, remaining: Math.max(0, main - played), progress: Math.min(1, played / main) }
}

export const DONE_STATUSES = new Set(['cleared', 'completed', 'dropped'])

export type DealVerdict = 'lowest' | 'near' | 'wait' | 'notOnSale' | 'unknown'

export const VERDICT_LABELS: Record<DealVerdict, string> = {
  lowest: '역대 최저가',
  near: '최저가 근접',
  wait: '더 기다리기',
  notOnSale: '할인 없음',
  unknown: '데이터 없음'
}

/** 현재가가 역대 최저가 대비 어느 수준인지 */
export function dealVerdict(price: PriceInfo | null, low: LowInfo | null, nearPct = 0.05): DealVerdict {
  if (!price) return 'unknown'
  // 할인하지 않는 중이면 (한 번도 할인한 적 없어 정가 = 최저가인 경우 포함) 판정하지 않는다
  if (price.discount === 0) return 'notOnSale'
  if (!low) return 'unknown'
  if (price.final <= low.amount) return 'lowest'
  if (price.final <= low.amount * (1 + nearPct)) return 'near'
  return 'wait'
}

/** 플레이타임 가중 장르 취향. 로그 스케일로 한 게임의 독식을 막는다 */
export function genreProfile(games: GameRow[], unplayedMinutes: number): GenreWeight[] {
  const m = new Map<string, GenreWeight & { contrib: { key: string; name: string; hours: number; platform: GameRow['platform']; w: number }[] }>()
  for (const g of games) {
    if (isUnplayed(g, unplayedMinutes) || g.playtimeKnown === false) continue
    const hours = g.playtimeMin / 60
    const w = Math.log1p(hours)
    for (const gr of g.genres) {
      const cur = m.get(gr.id) ?? { id: gr.id, name: genreName(gr.id, gr.name), weight: 0, hours: 0, count: 0, top: [], contrib: [] }
      cur.weight += WEAK_GENRES.has(gr.id) ? w * 0.4 : w
      cur.hours += hours
      cur.count++
      cur.contrib.push({ key: g.key, name: g.nameKo || g.name, hours, platform: g.platform, w })
      m.set(gr.id, cur)
    }
  }
  const list = [...m.values()].sort((a, b) => b.weight - a.weight)
  const max = list[0]?.weight || 1
  return list.map(({ contrib, ...x }) => ({
    ...x,
    weight: x.weight / max,
    top: contrib
      .sort((a, b) => b.w - a.w)
      .slice(0, 8)
      .map(({ w: _w, ...c }) => c)
  }))
}

/** 추천 게임과 장르가 겹치는 내 게임 중 많이 한 것 (겹치는 장르 수 × 로그 플레이타임 순) */
export function becauseOf(
  genreIds: string[],
  profile: GenreWeight[],
  limit = 4
): RecoReason['because'] {
  const want = new Set(genreIds)
  const byKey = new Map<string, RecoReason['because'][number] & { s: number }>()
  for (const p of profile) {
    if (!want.has(p.id)) continue
    for (const t of p.top) {
      const cur = byKey.get(t.key) ?? { ...t, shared: [], s: 0 }
      cur.shared.push(p.name)
      cur.s = cur.shared.length * Math.log1p(t.hours)
      byKey.set(t.key, cur)
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ s: _s, ...x }) => x)
}

/** 가격 이력을 계단형 그래프용으로 정리 (시간순, 중복 제거) */
export function normalizeHistory(points: PricePoint[]): PricePoint[] {
  const sorted = [...points].sort((a, b) => a.t - b.t)
  const out: PricePoint[] = []
  for (const p of sorted) {
    const last = out[out.length - 1]
    if (last && last.final === p.final && last.initial === p.initial) continue
    out.push(p)
  }
  return out
}

/** 한국 가격 / (미국 가격 × 환율). 1보다 작으면 한국이 더 쌈 */
export function regionRatio(g: Pick<GameRow, 'priceKr' | 'priceUs'>, rate: number): number | null {
  if (!g.priceKr || !g.priceUs || g.priceUs.initial <= 0 || g.priceKr.initial <= 0) return null
  return g.priceKr.initial / ((g.priceUs.initial / 100) * rate)
}

/** 플랫폼 사이 같은 게임을 찾을 때 쓰는 이름 (™®, 기종 표기, 문장부호 제거) */
export function titleKey(name: string): string {
  return name
    .replace(/[™®©]/g, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\((?:ps4|ps5|playstation\s*\d|xbox[^)]*|windows|pc|nintendo switch)[^)]*\)/g, '')
    .replace(/\b(?:ps4|ps5)\s*(?:&|and|\/)\s*(?:ps4|ps5)\b/g, '')
    .replace(/\b(?:ps4|ps5)\b/g, '')
    .replace(/\b(?:standard|digital|deluxe|ultimate|complete|definitive|goty|game of the year)\s*edition\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

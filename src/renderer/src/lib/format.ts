import type { PriceInfo } from '@shared/types'

const wonFmt = new Intl.NumberFormat('ko-KR')
const usdFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 원 단위 정수 → ₩12,000 */
export function won(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `₩${wonFmt.format(Math.round(v))}`
}

/** 큰 금액 요약 (₩1,234만) */
export function wonShort(v: number | null | undefined): string {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 100_000_000) return `₩${(v / 100_000_000).toFixed(1).replace(/\.0$/, '')}억`
  if (a >= 10_000) return `₩${wonFmt.format(Math.round(v / 10_000))}만`
  return won(v)
}

/** 센트 → $12.99 */
export function usd(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '—'
  return `$${usdFmt.format(cents / 100)}`
}

export function price(p: PriceInfo | null | undefined, which: 'initial' | 'final' = 'final'): string {
  if (!p) return '—'
  return p.currency === 'USD' ? usd(p[which]) : won(p[which])
}

export function hours(min: number | null | undefined, digits = 1): string {
  if (min == null) return '—'
  const h = min / 60
  if (h < 1 && min > 0) return `${Math.round(min)}분`
  return `${h.toFixed(h >= 100 ? 0 : digits).replace(/\.0$/, '')}시간`
}

export function hoursFromH(h: number | null | undefined): string {
  if (h == null) return '—'
  return `${h.toFixed(h >= 100 ? 0 : 1).replace(/\.0$/, '')}시간`
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

export function dateKo(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—'
  const d = typeof v === 'number' ? new Date(v) : new Date(v.length === 10 ? v + 'T00:00:00' : v)
  if (Number.isNaN(d.getTime())) return String(v)
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
}

export function relative(ms: number | null | undefined): string {
  if (!ms) return '—'
  const diff = Date.now() - ms
  const m = Math.round(diff / 60_000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}시간 전`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}일 전`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo}개월 전`
  return `${Math.round(mo / 12)}년 전`
}

export function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 60) return `${m}분`
  const h = Math.floor(m / 60)
  return `${h}시간 ${m % 60}분`
}

export function parseWon(input: string): number | null {
  const digits = input.replace(/[^\d]/g, '')
  if (!digits) return null
  return Number(digits)
}

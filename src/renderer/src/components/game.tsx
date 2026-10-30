import { useState } from 'react'
import { dealVerdict, VERDICT_LABELS, type DealVerdict } from '@shared/analytics'
import { STATUS_LABELS, STATUS_ORDER, type GameStatus, type LowInfo, type PriceInfo, type ReviewInfo } from '@shared/types'
import { cn } from '@/lib/cn'
import { price } from '@/lib/format'
import { Badge, type Tone } from './ui'

export function Cover({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) {
    return (
      <div className={cn('flex items-center justify-center bg-surface-2 px-3 text-center text-[12px] font-medium text-faint', className)}>
        {alt}
      </div>
    )
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} className={cn('bg-surface-2 object-cover', className)} />
}

export const STATUS_TONE: Record<GameStatus, Tone> = {
  none: 'muted',
  playing: 'brand',
  cleared: 'good',
  completed: 'good',
  dropped: 'bad',
  later: 'sale'
}

export function StatusBadge({ status, auto }: { status: GameStatus; auto?: boolean }) {
  if (status === 'none') return null
  return (
    <Badge tone={STATUS_TONE[status]} title={auto ? '자동으로 붙은 태그' : undefined}>
      {STATUS_LABELS[status]}
      {auto && <span className="opacity-60">·자동</span>}
    </Badge>
  )
}

export function StatusPicker({ value, onChange }: { value: GameStatus; onChange(s: GameStatus): void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {STATUS_ORDER.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={cn(
            'h-8 rounded-full px-3 text-[13px] font-medium ring-1 transition-colors',
            value === s ? 'bg-ink text-paper ring-ink' : 'text-muted ring-line hover:text-ink'
          )}
        >
          {STATUS_LABELS[s]}
        </button>
      ))}
    </div>
  )
}

export const VERDICT_TONE: Record<DealVerdict, Tone> = {
  lowest: 'good',
  near: 'brand',
  wait: 'sale',
  notOnSale: 'muted',
  unknown: 'muted'
}

export function VerdictBadge({ p, low }: { p: PriceInfo | null; low: LowInfo | null }) {
  const v = dealVerdict(p, low)
  if (v === 'unknown' || v === 'notOnSale') return null
  return <Badge tone={VERDICT_TONE[v]}>{VERDICT_LABELS[v]}</Badge>
}

/** 현재가 + (할인 시) 정가 취소선 + 할인율 */
/** compact: 좁은 카드용. 할인 전 가격은 숨기고 마우스를 올리면 보여 준다 */
export function PriceLine({ p, className, compact }: { p: PriceInfo | null; className?: string; compact?: boolean }) {
  if (!p) return <span className={cn('whitespace-nowrap text-faint', className)}>가격 없음</span>
  return (
    <span
      className={cn('num inline-flex items-baseline gap-1.5 whitespace-nowrap', className)}
      title={compact && p.discount > 0 ? `정가 ${price(p, 'initial')}` : undefined}
    >
      {p.discount > 0 && <span className="rounded bg-sale px-1 text-[11px] font-bold text-white dark:text-[#1a1300]">-{p.discount}%</span>}
      {p.discount > 0 && !compact && <span className="text-[12px] text-faint line-through">{price(p, 'initial')}</span>}
      <span className={cn('font-semibold', p.discount > 0 ? 'text-sale' : 'text-ink')}>{price(p)}</span>
    </span>
  )
}

/** Steam 평가: 긍정 비율에 따라 색을 다르게 */
export function ReviewBadge({ review, compact }: { review: ReviewInfo | null; compact?: boolean }) {
  if (!review || review.percent == null) return null
  const p = review.percent
  const tone = p >= 80 ? 'text-good' : p >= 70 ? 'text-brand' : p >= 40 ? 'text-sale' : 'text-bad'
  return (
    <span className={cn('num inline-flex items-center gap-1 text-[12px] whitespace-nowrap', tone)} title={`Steam 평가 ${review.count.toLocaleString()}개`}>
      <span className="font-semibold">{p}%</span>
      {!compact && review.label && <span className="text-muted">{review.label}</span>}
    </span>
  )
}

/** 역대 최저가 + 최대 할인율. 지금 할인 여부와 상관없이 같은 값 */
export function LowLine({ low, fmt, showSource, className }: { low: LowInfo | null; fmt(v: number): string; showSource?: boolean; className?: string }) {
  if (!low) return <span className={cn('text-faint', className)}>—</span>
  return (
    <span className={cn('num inline-flex items-baseline gap-1.5', className)}>
      <span className="font-semibold text-good">{fmt(low.amount)}</span>
      {low.cut > 0 && <span className="text-[12px] text-muted">최대 -{low.cut}%</span>}
      {showSource && low.source === 'estimate' && <span className="text-[11px] text-faint">(미국 최대 할인율 기준)</span>}
    </span>
  )
}

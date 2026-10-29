import { useState } from 'react'
import { dealVerdict, VERDICT_LABELS, type DealVerdict } from '@shared/analytics'
import { STATUS_LABELS, STATUS_ORDER, type GameStatus, type LowInfo, type PriceInfo } from '@shared/types'
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
export function PriceLine({ p, className }: { p: PriceInfo | null; className?: string }) {
  if (!p) return <span className={cn('text-faint', className)}>가격 없음</span>
  return (
    <span className={cn('num inline-flex items-baseline gap-1.5', className)}>
      {p.discount > 0 && <span className="rounded bg-sale px-1 text-[11px] font-bold text-white dark:text-[#1a1300]">-{p.discount}%</span>}
      {p.discount > 0 && <span className="text-[12px] text-faint line-through">{price(p, 'initial')}</span>}
      <span className={cn('font-semibold', p.discount > 0 ? 'text-sale' : 'text-ink')}>{price(p)}</span>
    </span>
  )
}

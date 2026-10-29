// 가벼운 SVG 차트 (외부 차트 라이브러리 없이 테마 색상을 그대로 사용)
import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** 가로 막대 목록: 라벨 + 막대 + 값 */
export function BarList({
  items,
  format,
  color = 'var(--chart-1)',
  onClick
}: {
  items: { key: string; label: ReactNode; value: number; sub?: ReactNode }[]
  format(v: number): string
  color?: string
  onClick?(key: string): void
}) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.key}>
          <button
            type="button"
            disabled={!onClick}
            onClick={() => onClick?.(it.key)}
            className={cn('group block w-full text-left', onClick && 'cursor-pointer')}
          >
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
              <span className={cn('truncate text-ink', onClick && 'group-hover:underline')}>{it.label}</span>
              <span className="num shrink-0 text-muted">
                {format(it.value)}
                {it.sub && <span className="ml-1.5 text-faint">{it.sub}</span>}
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface-2">
              <div className="h-2 rounded-full" style={{ width: `${(it.value / max) * 100}%`, background: color }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** 세로 막대 (날짜/월별) */
export function Columns({
  data,
  format,
  height = 160,
  color = 'var(--chart-1)',
  labelEvery = 1
}: {
  data: { label: string; value: number; title?: string }[]
  format(v: number): string
  height?: number
  color?: string
  labelEvery?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  const W = 100 / Math.max(1, data.length)
  return (
    <div>
      <div className="relative" style={{ height }}>
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2="100" y1={height * f} y2={height * f} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {data.map((d, i) => {
            const h = (d.value / max) * (height - 6)
            return (
              <rect
                key={d.label + i}
                x={i * W + W * 0.18}
                width={W * 0.64}
                y={height - h}
                height={Math.max(h, d.value > 0 ? 1.5 : 0)}
                rx="0.6"
                fill={color}
                opacity={hover == null || hover === i ? 1 : 0.45}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            )
          })}
        </svg>
        {hover != null && data[hover] && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-surface px-2 py-1 text-[12px] whitespace-nowrap shadow-[var(--shadow)]"
            style={{ left: `${(hover + 0.5) * W}%` }}
          >
            <span className="text-muted">{data[hover].title ?? data[hover].label}</span>
            <span className="num ml-2 font-semibold text-ink">{format(data[hover].value)}</span>
          </div>
        )}
      </div>
      <div className="mt-1.5 flex text-[11px] text-faint">
        {data.map((d, i) => (
          <span key={d.label + i} className="truncate text-center" style={{ width: `${W}%` }}>
            {i % labelEvery === 0 ? d.label : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

export interface StepSeries {
  name: string
  color: string
  points: { t: number; v: number }[]
}

/** 계단형 가격 그래프. 가격은 다음 변동 전까지 유지된다 */
export function StepChart({
  series,
  format,
  height = 200,
  markers = []
}: {
  series: StepSeries[]
  format(v: number): string
  height?: number
  markers?: { v: number; label: string; color: string }[]
}) {
  const [hoverT, setHoverT] = useState<number | null>(null)
  const all = series.flatMap((s) => s.points)
  const now = Date.now()
  const geo = useMemo(() => {
    if (!all.length) return null
    const t0 = Math.min(...all.map((p) => p.t))
    const t1 = Math.max(now, ...all.map((p) => p.t))
    const vals = [...all.map((p) => p.v), ...markers.map((m) => m.v)]
    const vMax = Math.max(...vals) * 1.08 || 1
    return { t0, t1: t1 === t0 ? t0 + 1 : t1, vMax }
  }, [all, markers, now])
  if (!geo) return <div className="flex items-center justify-center text-[13px] text-faint" style={{ height }}>가격 기록이 아직 없습니다</div>
  const W = 1000
  const x = (t: number) => ((t - geo.t0) / (geo.t1 - geo.t0)) * W
  const y = (v: number) => height - (v / geo.vMax) * (height - 10)
  const path = (pts: { t: number; v: number }[]) => {
    if (!pts.length) return ''
    let d = `M${x(pts[0].t)},${y(pts[0].v)}`
    for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i].t)} V${y(pts[i].v)}`
    d += ` H${x(geo.t1)}`
    return d
  }
  const valueAt = (pts: { t: number; v: number }[], t: number) => {
    let v: number | null = null
    for (const p of pts) if (p.t <= t) v = p.v
    return v
  }
  const years: number[] = []
  const y0 = new Date(geo.t0).getFullYear()
  const y1 = new Date(geo.t1).getFullYear()
  for (let yy = y0 + 1; yy <= y1; yy++) years.push(new Date(yy, 0, 1).getTime())
  const step = Math.ceil(years.length / 8) || 1

  return (
    <div>
      <div
        className="relative"
        style={{ height }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setHoverT(geo.t0 + ((e.clientX - r.left) / r.width) * (geo.t1 - geo.t0))
        }}
        onMouseLeave={() => setHoverT(null)}
      >
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          {years.map((t) => (
            <line key={t} x1={x(t)} x2={x(t)} y1="0" y2={height} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
          ))}
          {markers.map((m) => (
            <line key={m.label} x1="0" x2={W} y1={y(m.v)} y2={y(m.v)} stroke={m.color} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          ))}
          {series.map((s) => (
            <path key={s.name} d={path(s.points)} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          ))}
          {hoverT != null && <line x1={x(hoverT)} x2={x(hoverT)} y1="0" y2={height} stroke="var(--line-strong)" vectorEffect="non-scaling-stroke" />}
        </svg>
        {hoverT != null && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-md border border-line bg-surface px-2 py-1 text-[12px] shadow-[var(--shadow)]"
            style={{ left: `min(calc(${((hoverT - geo.t0) / (geo.t1 - geo.t0)) * 100}% + 8px), calc(100% - 150px))` }}
          >
            <div className="text-muted">{new Date(hoverT).toLocaleDateString('ko-KR')}</div>
            {series.map((s) => {
              const v = valueAt(s.points, hoverT)
              return (
                <div key={s.name} className="num flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  <span className="text-muted">{s.name}</span>
                  <span className="font-semibold text-ink">{v == null ? '—' : format(v)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] text-faint">
        {years.map((t, i) =>
          i % step === 0 ? (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(x(t) / W) * 100}%` }}>
              {new Date(t).getFullYear()}
            </span>
          ) : null
        )}
      </div>
      {(markers.length > 0 || series.length > 1) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
          {markers.map((m) => (
            <span key={m.label} className="inline-flex items-center gap-1.5">
              <span className="h-0 w-3 border-t border-dashed" style={{ borderColor: m.color }} />
              {m.label} {format(m.v)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** 원형 진행 표시 */
export function Ring({ value, size = 44, stroke = 5, color = 'var(--brand)', children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={`${c * v} ${c}`} strokeLinecap="round" />
      </svg>
      {children && <span className="absolute text-[11px] font-semibold text-ink">{children}</span>}
    </div>
  )
}

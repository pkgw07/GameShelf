import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  icon,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-brand text-brand-ink hover:opacity-90',
        variant === 'secondary' && 'border border-line bg-surface text-ink hover:bg-surface-2',
        variant === 'ghost' && 'text-muted hover:bg-surface-2 hover:text-ink',
        variant === 'danger' && 'border border-line bg-surface text-bad hover:bg-bad-soft',
        className
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function Panel({
  title,
  action,
  children,
  className,
  bodyClass
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
}) {
  return (
    <section className={cn('rounded-2xl border border-line bg-surface', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4">
          {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
          {action}
        </header>
      )}
      <div className={cn('px-5 pb-5', title || action ? 'pt-3' : 'pt-5', bodyClass)}>{children}</div>
    </section>
  )
}

export type Tone = 'neutral' | 'brand' | 'sale' | 'good' | 'bad' | 'muted'

export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap',
        tone === 'neutral' && 'bg-surface-2 text-ink ring-1 ring-line',
        tone === 'brand' && 'bg-brand-soft text-brand',
        tone === 'sale' && 'bg-sale-soft text-sale',
        tone === 'good' && 'bg-brand-soft text-good',
        tone === 'bad' && 'bg-bad-soft text-bad',
        tone === 'muted' && 'text-faint ring-1 ring-line',
        className
      )}
    >
      {children}
    </span>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cn(
        'h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none',
        className
      )}
    />
  )
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={cn('h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink focus:border-brand focus:outline-none', className)}
    >
      {children}
    </select>
  )
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange(v: boolean): void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2.5">
      <span>
        <span className="block text-sm text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[13px] text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-line-strong')}
      >
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md'
}: {
  value: T
  options: { value: T; label: ReactNode; count?: number }[]
  onChange(v: T): void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-3 font-medium whitespace-nowrap transition-colors',
            size === 'sm' ? 'h-7 text-[13px]' : 'h-8 text-sm',
            value === o.value ? 'bg-surface text-ink shadow-[var(--shadow)] ring-1 ring-line' : 'text-muted hover:text-ink'
          )}
        >
          {o.label}
          {o.count != null && <span className="num ml-1.5 text-faint">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Progress({ value, tone = 'brand', className }: { value: number; tone?: 'brand' | 'sale' | 'bad'; className?: string }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line', className)}>
      <div
        className={cn('h-full rounded-full', tone === 'brand' && 'bg-brand', tone === 'sale' && 'bg-sale', tone === 'bad' && 'bg-bad')}
        style={{ width: `${v * 100}%` }}
      />
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-line-strong px-5 py-6">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="max-w-prose text-[13px] text-muted">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-block h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-brand', className)}
      aria-label="불러오는 중"
    />
  )
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-faint">{hint}</span>}
    </label>
  )
}

/** 큰 숫자 + 작은 설명 */
export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'sale' | 'good' | 'bad' }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-muted">{label}</div>
      <div
        className={cn(
          'num mt-0.5 truncate text-2xl font-bold',
          tone === 'sale' ? 'text-sale' : tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-ink'
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-[12px] text-faint">{sub}</div>}
    </div>
  )
}

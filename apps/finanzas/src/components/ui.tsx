import type { ReactNode } from 'react'
import { formatMoney } from '@/lib/money'

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`card min-w-0 ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}) {
  const toneClass = {
    neutral: 'text-slate-100',
    good: 'text-good',
    warn: 'text-warn',
    bad: 'text-bad',
  }[tone]
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

export function Money({ cents, signed = false }: { cents: number; signed?: boolean }) {
  const tone = cents < 0 ? 'text-bad' : cents > 0 && signed ? 'text-good' : ''
  return <span className={`tabular-nums ${tone}`}>{formatMoney(cents)}</span>
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' }) {
  const cls = {
    neutral: 'bg-edge text-slate-300',
    good: 'bg-good/15 text-good',
    warn: 'bg-warn/15 text-warn',
    bad: 'bg-bad/15 text-bad',
    info: 'bg-brand/15 text-brand',
  }[tone]
  return <span className={`pill ${cls}`}>{children}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>
}

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    // min-w-0 deja que el contenedor achique dentro de un grid; el scroll queda acá.
    <div className="-mx-4 min-w-0 overflow-x-auto px-4">
      <table className="w-full min-w-[36rem] border-collapse">
        <thead>{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/** Barras horizontales, sin librería de charts: es un div con un ancho. */
export function BarList({
  items,
  max,
}: {
  items: Array<{ label: string; value: number; hint?: string }>
  max?: number
}) {
  const top = max ?? Math.max(...items.map((i) => Math.abs(i.value)), 1)
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.label}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate">{i.label}</span>
            <span className="tabular-nums text-muted">{i.hint ?? formatMoney(i.value)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-edge">
            <div
              className="h-1.5 rounded-full bg-brand"
              style={{ width: `${Math.max(2, (Math.abs(i.value) / top) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

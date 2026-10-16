import Link from 'next/link'
import { CLAIM_LABEL, CLAIM_TONE, HEALTH_LABEL, HEALTH_TONE, SIGNAL_LABEL, SIGNAL_TONE } from '@/lib/format'

export function SignalBadge({ signal }: { signal?: string | null }) {
  if (!signal) return <span className="text-xs text-neutral-400">–</span>
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${SIGNAL_TONE[signal] ?? ''}`}>
      {SIGNAL_LABEL[signal] ?? signal}
    </span>
  )
}

export function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-neutral-200 p-4 dark:border-neutral-800 ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold text-neutral-500">{title}</h2>}
      {children}
    </section>
  )
}

export function Stat({ label, value, sub, tone = '' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className={`text-xs tabular-nums ${tone}`}>{sub}</div>}
    </div>
  )
}

export function TickerLink({ ticker }: { ticker: string }) {
  return (
    <Link href={`/stock/${ticker}`} className="font-medium underline-offset-2 hover:underline">
      {ticker}
    </Link>
  )
}

export function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
          {t}
        </span>
      ))}
    </span>
  )
}

export const inputCls =
  'w-full rounded-md border border-neutral-300 bg-transparent px-2.5 py-1.5 text-sm dark:border-neutral-700'
export const buttonCls =
  'rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800'

export function ClaimBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${CLAIM_TONE[status] ?? ''}`}>
      {CLAIM_LABEL[status] ?? status}
    </span>
  )
}

export function HealthBadge({ level, stale }: { level?: string; stale?: boolean }) {
  if (!level || level === 'no_claims') return <span className="text-xs text-neutral-400">–</span>
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${HEALTH_TONE[level] ?? ''}`} title={stale ? '점검한 지 오래됨' : undefined}>
      {HEALTH_LABEL[level] ?? level}
      {stale && ' ·오래됨'}
    </span>
  )
}

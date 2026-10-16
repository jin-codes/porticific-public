import { brandColor, needsOutline } from '@/lib/brand-colors'

export interface Slice {
  ticker: string
  /** share of total, percent */
  pct: number
}

/** Very dark colors (black, navy) get a thin light outline so they stay visible in dark mode. */
const outline = (color: string) => (needsOutline(color) ? { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.4)' } : {})

/** Stacked allocation bar with a legend; each ticker keeps its own logo-inspired color. */
export function AllocationBar({ slices, cashPct }: { slices: Slice[]; cashPct?: number | null }) {
  const items = [
    ...slices.map((s) => ({ key: s.ticker, label: s.ticker, pct: s.pct, color: brandColor(s.ticker) })),
    ...(cashPct != null && cashPct > 0 ? [{ key: '__cash', label: '현금', pct: cashPct, color: '#4B5563' }] : []),
  ].filter((i) => i.pct > 0)

  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="종목별 비중">
        {items.map((i) => (
          <div key={i.key} title={`${i.label} ${i.pct}%`} style={{ width: `${i.pct}%`, backgroundColor: i.color, ...outline(i.color) }} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs tabular-nums">
        {items.map((i) => (
          <li key={i.key} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: i.color, ...outline(i.color) }} aria-hidden />
            <span className="font-medium">{i.label}</span>
            <span className="text-neutral-500">{i.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

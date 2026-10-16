interface Point {
  date: string
  price: number
}

/** Minimal dependency-free line chart (server component). `avgCost` draws a dashed reference line. */
export function PriceChart({ points, avgCost }: { points: Point[]; avgCost?: number | null }) {
  if (points.length < 2) return <p className="text-sm text-neutral-500">차트를 그릴 시세 기록이 부족합니다.</p>

  const W = 640
  const H = 160
  const pad = { l: 8, r: 8, t: 8, b: 8 }
  const values = points.map((p) => p.price)
  const lo = Math.min(...values, ...(avgCost ? [avgCost] : []))
  const hi = Math.max(...values, ...(avgCost ? [avgCost] : []))
  const span = hi - lo || 1
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ')
  const up = points[points.length - 1].price >= points[0].price
  const stroke = up ? '#10b981' : '#ef4444'
  const first = points[0]
  const last = points[points.length - 1]

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" role="img" aria-label={`${first.date}부터 ${last.date}까지 종가 추이`}>
        {avgCost ? (
          <line x1={pad.l} x2={W - pad.r} y1={y(avgCost)} y2={y(avgCost)} stroke="currentColor" strokeOpacity="0.35" strokeDasharray="4 4" />
        ) : null}
        <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(last.price)} r="3.5" fill={stroke} />
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs tabular-nums text-neutral-500">
        <span>{first.date} · ${first.price.toFixed(2)}</span>
        {avgCost ? <span>점선: 평단 ${avgCost.toFixed(2)}</span> : <span />}
        <span>{last.date} · ${last.price.toFixed(2)}</span>
      </figcaption>
    </figure>
  )
}

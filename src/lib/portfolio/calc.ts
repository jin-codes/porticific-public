// Pure portfolio math, ported from scripts/portfolio.py (report summary), lib/tags.py and lib/dca.py.
// No I/O here so everything is unit-testable.

export const SIGNALS = [
  'add_more', 'hold', 'watch', 'trim', 'sell', 'urgent_sell', 'avoid_chasing', // holdings
  'buy', 'buy_wait', 'drop_watch', // watchlist
] as const
export type Signal = (typeof SIGNALS)[number]

export interface HoldingInput {
  ticker: string
  quantity: number
  avg_cost: number
}

export interface SummaryRow {
  ticker: string
  quantity: number
  avg_cost: number
  cost_basis: number
  price: number | null
  market_value?: number
  unrealized_pnl?: number
  unrealized_pnl_pct?: number | null
  allocation_pct: number | null
}

export interface Summary {
  holdings: SummaryRow[]
  total_cost_basis: number
  total_market_value: number
  total_unrealized_pnl: number
  total_unrealized_pnl_pct: number | null
  total_realized_pnl: number
  /** Cash tracking is opt-in: null until the user records a first cash event. */
  cash: number | null
  /** cash / (invested market value + cash), percent */
  cash_pct: number | null
  /** invested market value + cash */
  total_assets: number | null
}

const round = (n: number, d = 2) => {
  const f = 10 ** d
  return Math.round(n * f) / f
}

/** Holdings valued at the latest known price. A holding without a price is valued at cost. */
export function buildSummary(
  holdings: HoldingInput[],
  prices: Record<string, number | undefined>,
  totalRealizedPnl = 0,
  cash: number | null = null
): Summary {
  let totalCost = 0
  let totalValue = 0
  const rows: SummaryRow[] = holdings.map((h) => {
    const costBasis = h.quantity * h.avg_cost
    const price = prices[h.ticker]
    const row: SummaryRow = {
      ticker: h.ticker,
      quantity: h.quantity,
      avg_cost: h.avg_cost,
      cost_basis: round(costBasis),
      price: price ?? null,
      allocation_pct: null,
    }
    if (price !== undefined) {
      const marketValue = h.quantity * price
      const pnl = marketValue - costBasis
      row.market_value = round(marketValue)
      row.unrealized_pnl = round(pnl)
      row.unrealized_pnl_pct = costBasis ? round((pnl / costBasis) * 100) : null
      totalValue += marketValue
    } else {
      totalValue += costBasis
    }
    totalCost += costBasis
    return row
  })

  for (const r of rows) {
    const value = r.market_value ?? r.cost_basis
    r.allocation_pct = totalValue ? round((value / totalValue) * 100) : null
  }

  return {
    holdings: rows,
    total_cost_basis: round(totalCost),
    total_market_value: round(totalValue),
    total_unrealized_pnl: round(totalValue - totalCost),
    total_unrealized_pnl_pct: totalCost ? round(((totalValue - totalCost) / totalCost) * 100) : null,
    total_realized_pnl: round(totalRealizedPnl),
    cash: cash == null ? null : round(cash),
    cash_pct: cash == null || totalValue + cash <= 0 ? null : round((cash / (totalValue + cash)) * 100),
    total_assets: cash == null ? null : round(totalValue + cash),
  }
}

// ----------------------------------------------------------------------- tags

export const UNTAGGED = '(untagged)'

/** Trim, drop empties, de-duplicate case-insensitively (first spelling wins). */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const t = raw.trim()
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase())
      out.push(t)
    }
  }
  return out
}

/** A row with several tags appears under each of them; untagged rows under UNTAGGED. */
export function groupByTag<T extends { ticker: string }>(
  rows: T[],
  tagsByTicker: Record<string, string[] | undefined>
): Record<string, T[]> {
  const groups: Record<string, T[]> = {}
  for (const row of rows) {
    const tags = tagsByTicker[row.ticker]
    for (const tag of tags && tags.length ? tags : [UNTAGGED]) (groups[tag] ??= []).push(row)
  }
  return groups
}

// ------------------------------------------------------------------------ DCA

export interface DcaPlanInput {
  daily_amount_krw: number
  start_date: string
  last_synced_date: string | null
}

export interface EstimatedBuy {
  date: string
  price: number
  fx: number
  quantity: number
}

const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** First day not yet synced: the day after last_synced_date, else the plan's start date. */
export function dcaStartDate(plan: DcaPlanInput): string {
  return plan.last_synced_date ? addDays(plan.last_synced_date, 1) : plan.start_date
}

/**
 * Estimate the buys a daily KRW plan would have made: quantity = KRW amount /
 * that day's USD/KRW close / that day's close. `closes` and `fxCloses` map
 * ISO date -> close. Only completed days before `today` count, and a day uses
 * the latest FX quote on or before it (FX trades on US holidays, so forward-fill).
 */
export function estimateDcaBuys(
  plan: DcaPlanInput,
  closes: Record<string, number>,
  fxCloses: Record<string, number>,
  today: string
): EstimatedBuy[] {
  const start = dcaStartDate(plan)
  if (start >= today) return []

  const fxDays = Object.keys(fxCloses).sort()
  const buys: EstimatedBuy[] = []
  for (const day of Object.keys(closes).sort()) {
    if (day < start || day >= today) continue
    const prior = fxDays.filter((d) => d <= day)
    if (!prior.length) continue
    const fx = fxCloses[prior[prior.length - 1]]
    const price = closes[day]
    buys.push({
      date: day,
      price: round(price, 4),
      fx,
      quantity: round(plan.daily_amount_krw / fx / price, 6),
    })
  }
  return buys
}

// ------------------------------------------------------------ thesis health

export const CLAIM_STATUSES = ['unchecked', 'intact', 'weakened', 'broken'] as const
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]
export const VERDICTS = ['intact', 'weakened', 'broken'] as const
export type Verdict = (typeof VERDICTS)[number]

export type ThesisHealthLevel = 'no_claims' | 'unchecked' | 'intact' | 'at_risk' | 'broken'

export interface ThesisHealth {
  level: ThesisHealthLevel
  total: number
  counts: Record<ClaimStatus, number>
  /** days since the oldest check among checked claims; null when nothing was checked */
  oldest_check_days: number | null
  /** true when any checked claim has not been re-checked within staleAfterDays */
  stale: boolean
}

/**
 * Roll a ticker's active claims up to one status: any broken claim breaks the thesis, any weakened
 * one puts it at risk, and unchecked claims never count as evidence either way.
 */
export function thesisHealth(
  claims: { status: string; last_checked: string | null }[],
  today: string,
  staleAfterDays = 10
): ThesisHealth {
  const counts: Record<ClaimStatus, number> = { unchecked: 0, intact: 0, weakened: 0, broken: 0 }
  let oldest: number | null = null
  for (const c of claims) {
    counts[(CLAIM_STATUSES as readonly string[]).includes(c.status) ? (c.status as ClaimStatus) : 'unchecked']++
    if (c.last_checked) {
      const age = Math.round((Date.parse(today) - Date.parse(c.last_checked)) / 86_400_000)
      oldest = oldest == null ? age : Math.max(oldest, age)
    }
  }
  const level: ThesisHealthLevel =
    claims.length === 0 ? 'no_claims'
    : counts.broken > 0 ? 'broken'
    : counts.weakened > 0 ? 'at_risk'
    : counts.intact > 0 ? 'intact'
    : 'unchecked'
  return { level, total: claims.length, counts, oldest_check_days: oldest, stale: oldest != null && oldest > staleAfterDays }
}

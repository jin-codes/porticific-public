import { describe, expect, it } from 'vitest'
import {
  buildSummary,
  dcaStartDate,
  estimateDcaBuys,
  groupByTag,
  normalizeTags,
  thesisHealth,
  UNTAGGED,
} from '@/lib/portfolio/calc'

describe('buildSummary', () => {
  it('values holdings at price, falls back to cost without a price, and computes allocation', () => {
    const s = buildSummary(
      [
        { ticker: 'AAA', quantity: 2, avg_cost: 100 },
        { ticker: 'BBB', quantity: 1, avg_cost: 50 },
      ],
      { AAA: 150 },
      12.345
    )
    expect(s.total_cost_basis).toBe(250)
    expect(s.total_market_value).toBe(350) // 300 + 50 at cost
    expect(s.total_unrealized_pnl).toBe(100)
    expect(s.total_unrealized_pnl_pct).toBe(40)
    expect(s.total_realized_pnl).toBe(12.35)
    expect(s.holdings[0]).toMatchObject({ unrealized_pnl: 100, unrealized_pnl_pct: 50, allocation_pct: 85.71 })
    expect(s.holdings[1].price).toBeNull()
    expect(s.holdings[1].allocation_pct).toBe(14.29)
  })

  it('reports cash share of total assets only when cash is tracked', () => {
    const holdings = [{ ticker: 'AAA', quantity: 1, avg_cost: 100 }]
    const untracked = buildSummary(holdings, { AAA: 100 })
    expect(untracked.cash).toBeNull()
    expect(untracked.cash_pct).toBeNull()
    expect(untracked.total_assets).toBeNull()

    const tracked = buildSummary(holdings, { AAA: 100 }, 0, 300)
    expect(tracked.cash).toBe(300)
    expect(tracked.total_assets).toBe(400)
    expect(tracked.cash_pct).toBe(75)
    expect(tracked.holdings[0].allocation_pct).toBe(100) // share of invested money, unchanged by cash

    expect(buildSummary([], {}, 0, 0).cash_pct).toBeNull() // nothing at all: no ratio
    expect(buildSummary([], {}, 0, 50).cash_pct).toBe(100)
  })

  it('handles an empty portfolio', () => {
    const s = buildSummary([], {})
    expect(s.total_market_value).toBe(0)
    expect(s.total_unrealized_pnl_pct).toBeNull()
  })
})

describe('tags', () => {
  it('normalizes: trims, drops empties, dedupes case-insensitively', () => {
    expect(normalizeTags([' AI ', 'ai', '', 'Quantum', 'quantum '])).toEqual(['AI', 'Quantum'])
  })
  it('groups rows under every tag, untagged separately', () => {
    const rows = [{ ticker: 'A' }, { ticker: 'B' }, { ticker: 'C' }]
    const g = groupByTag(rows, { A: ['x', 'y'], B: ['x'], C: [] })
    expect(g.x.map((r) => r.ticker)).toEqual(['A', 'B'])
    expect(g.y.map((r) => r.ticker)).toEqual(['A'])
    expect(g[UNTAGGED].map((r) => r.ticker)).toEqual(['C'])
  })
})

describe('dca', () => {
  const plan = { daily_amount_krw: 13_000, start_date: '2026-09-14', last_synced_date: null }
  it('starts at start_date, then resumes the day after last_synced_date', () => {
    expect(dcaStartDate(plan)).toBe('2026-09-14')
    expect(dcaStartDate({ ...plan, last_synced_date: '2026-09-30' })).toBe('2026-10-01')
    expect(dcaStartDate({ ...plan, last_synced_date: '2026-01-31' })).toBe('2026-02-01')
  })
  it('estimates quantity from KRW amount, forward-filled FX and close; skips today and earlier days', () => {
    const buys = estimateDcaBuys(
      plan,
      { '2026-09-11': 10, '2026-09-14': 100, '2026-09-15': 200, '2026-09-16': 50 },
      { '2026-09-10': 1300, '2026-09-15': 1300 },
      '2026-09-16'
    )
    expect(buys).toEqual([
      { date: '2026-09-14', price: 100, fx: 1300, quantity: 0.1 },
      { date: '2026-09-15', price: 200, fx: 1300, quantity: 0.05 },
    ])
  })
  it('returns nothing when already caught up', () => {
    expect(estimateDcaBuys({ ...plan, last_synced_date: '2026-09-15' }, { '2026-09-16': 1 }, { '2026-09-10': 1 }, '2026-09-16')).toEqual([])
  })
})

describe('thesisHealth', () => {
  const today = '2026-10-15'
  const c = (status: string, last_checked: string | null = null) => ({ status, last_checked })

  it('reports no_claims and unchecked', () => {
    expect(thesisHealth([], today).level).toBe('no_claims')
    expect(thesisHealth([c('unchecked'), c('unchecked')], today).level).toBe('unchecked')
  })
  it('lets the worst claim win', () => {
    expect(thesisHealth([c('intact', today), c('intact', today)], today).level).toBe('intact')
    expect(thesisHealth([c('intact', today), c('weakened', today)], today).level).toBe('at_risk')
    expect(thesisHealth([c('weakened', today), c('broken', today), c('intact', today)], today).level).toBe('broken')
  })
  it('does not let unchecked claims dilute a verdict', () => {
    const h = thesisHealth([c('intact', today), c('unchecked')], today)
    expect(h.level).toBe('intact')
    expect(h.counts).toEqual({ unchecked: 1, intact: 1, weakened: 0, broken: 0 })
  })
  it('flags stale checks by the oldest checked claim', () => {
    expect(thesisHealth([c('intact', '2026-10-14'), c('intact', '2026-10-01')], today)).toMatchObject({ oldest_check_days: 14, stale: true })
    expect(thesisHealth([c('intact', '2026-10-10')], today)).toMatchObject({ oldest_check_days: 5, stale: false })
    expect(thesisHealth([c('unchecked')], today)).toMatchObject({ oldest_check_days: null, stale: false })
  })
  it('treats an unknown status as unchecked', () => {
    expect(thesisHealth([c('???')], today).counts.unchecked).toBe(1)
  })
})

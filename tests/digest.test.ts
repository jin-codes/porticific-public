import { describe, expect, it } from 'vitest'
import { collectAlerts, renderDigest, thesisTransitions, type AlertInput } from '@/lib/notify/digest'

const base: AlertInput = {
  today: '2026-10-16',
  checks: [],
  claimText: {},
  thesisSince: '2026-10-09',
  signals: [],
  events: [],
  targets: [],
}
const chk = (claim_id: string, date: string, verdict: string) => ({ claim_id, ticker: 'AAPL', date, verdict, evidence: 'e' })

describe('thesisTransitions', () => {
  it('alerts only when the verdict got worse than the previous check', () => {
    const t = thesisTransitions([chk('a', '2026-10-01', 'intact'), chk('a', '2026-10-12', 'weakened'), chk('a', '2026-10-14', 'weakened')], '2026-10-09')
    expect(t.map((x) => x.date)).toEqual(['2026-10-12'])
    expect(t[0].previous).toBe('intact')
  })
  it('alerts weakened to broken, and a first-ever bad verdict', () => {
    expect(thesisTransitions([chk('a', '2026-10-10', 'weakened'), chk('a', '2026-10-14', 'broken')], '2026-10-09')).toHaveLength(2)
  })
  it('ignores improvements, intact, and anything before the window', () => {
    expect(thesisTransitions([chk('a', '2026-10-01', 'broken'), chk('a', '2026-10-12', 'intact')], '2026-10-09')).toHaveLength(0)
    expect(thesisTransitions([chk('a', '2026-10-01', 'intact'), chk('a', '2026-10-05', 'weakened')], '2026-10-09')).toHaveLength(0)
  })
  it('tracks claims independently', () => {
    const t = thesisTransitions([chk('a', '2026-10-10', 'intact'), chk('b', '2026-10-12', 'weakened')], '2026-10-09')
    expect(t.map((x) => x.claim_id)).toEqual(['b'])
  })
})

describe('collectAlerts', () => {
  it('emits signal alerts only for risky holdings signals and watchlist buys, and only on change', () => {
    const a = collectAlerts({
      ...base,
      signals: [
        { ticker: 'AAA', held: true, date: '2026-10-15', signal: 'sell', previous_signal: 'hold', reasoning: 'r' },
        { ticker: 'BBB', held: true, date: '2026-10-15', signal: 'sell', previous_signal: 'sell', reasoning: 'r' },
        { ticker: 'CCC', held: true, date: '2026-10-15', signal: 'add_more', previous_signal: 'hold', reasoning: 'r' },
        { ticker: 'DDD', held: false, date: '2026-10-15', signal: 'buy', previous_signal: 'buy_wait', reasoning: 'r' },
        { ticker: 'EEE', held: false, date: '2026-10-15', signal: 'sell', previous_signal: null, reasoning: 'r' },
      ],
    })
    expect(a.map((x) => x.ticker)).toEqual(['AAA', 'DDD'])
    expect(a[0].high).toBe(true)
  })
  it('alerts on near events but not past ones or macro', () => {
    const a = collectAlerts({
      ...base,
      events: [
        { ticker: 'AAPL', event_date: '2026-10-18', kind: 'earnings', title: null },
        { ticker: 'AAPL', event_date: '2026-10-10', kind: 'earnings', title: null },
        { ticker: 'FOMC', event_date: '2026-10-17', kind: 'macro', title: 'FOMC' },
      ],
    })
    expect(a).toHaveLength(1)
    expect(a[0].title).toContain('2일 후')
  })
  it('alerts when a watchlist price reaches the target, keyed by the target', () => {
    const a = collectAlerts({ ...base, targets: [{ ticker: 'X', price: 9.5, target_price: 10 }, { ticker: 'Y', price: 11, target_price: 10 }] })
    expect(a.map((x) => x.key)).toEqual(['target:X:10'])
  })
  it('respects the enabled kinds and sorts urgent first', () => {
    const input: AlertInput = {
      ...base,
      checks: [chk('a', '2026-10-12', 'weakened')],
      targets: [{ ticker: 'A', price: 1, target_price: 2 }],
      signals: [{ ticker: 'Z', held: true, date: '2026-10-15', signal: 'urgent_sell', previous_signal: 'hold', reasoning: null }],
    }
    expect(collectAlerts(input).map((x) => x.kind)).toEqual(['signal', 'target', 'thesis'])
    expect(collectAlerts(input, ['target']).map((x) => x.kind)).toEqual(['target'])
  })
  it('produces stable keys so a repeated run dedupes', () => {
    const input: AlertInput = { ...base, checks: [chk('a', '2026-10-12', 'weakened')] }
    expect(collectAlerts(input)[0].key).toBe(collectAlerts(input)[0].key)
  })
})

describe('price moves', () => {
  const mv = (ticker: string, change_pct: number | null, held = true) => ({ ticker, held, date: '2026-10-15', price: 100, change_pct })

  it('alerts on moves at or beyond the threshold, both ways, and ignores smaller or missing ones', () => {
    const a = collectAlerts({ ...base, moves: [mv('UP', 5), mv('DN', -6.2), mv('SM', 4.9), mv('NA', null)] }, ['price'])
    expect(a.map((x) => x.ticker).sort()).toEqual(['DN', 'UP'])
    expect(a.find((x) => x.ticker === 'DN')).toMatchObject({ direction: 'down', kind: 'price', high: false })
    expect(a.find((x) => x.ticker === 'UP')?.title).toBe('UP +5.0% $100.00 (보유)')
  })
  it('honours a custom threshold and marks a double-threshold move urgent', () => {
    const input = { ...base, movePct: 3, moves: [mv('A', 3.1), mv('B', -6.5, false)] }
    const a = collectAlerts(input, ['price'])
    expect(a).toHaveLength(2)
    expect(a.find((x) => x.ticker === 'B')).toMatchObject({ high: true })
    expect(a.find((x) => x.ticker === 'B')?.title).toBe('B -6.5% $100.00')
  })
  it('keys by ticker, day, direction and band: the same band never repeats, a doubled move alerts again', () => {
    const k = (p: number) => collectAlerts({ ...base, moves: [mv('RKLB', p)] }, ['price'])[0].key
    expect(k(-5.2)).toBe(k(-9.9))
    expect(k(-10.3)).not.toBe(k(-5.2))
    expect(k(5.2)).not.toBe(k(-5.2))
  })
  it('is off unless the price kind is enabled', () => {
    expect(collectAlerts({ ...base, moves: [mv('A', 9)] }, ['thesis', 'signal', 'event', 'target'])).toHaveLength(0)
  })
})

describe('renderDigest', () => {
  it('escapes HTML, counts urgent alerts and links tickers', () => {
    const m = renderDigest(
      [{ key: 'k', kind: 'signal', ticker: 'AAPL', high: true, title: 'AAPL <b>', body: 'a & b', }],
      { date: '2026-10-16', siteUrl: 'https://x.app/' }
    )
    expect(m.subject).toBe('[Porticific] 알림 1건 · 긴급 1 (2026-10-16)')
    expect(m.html).toContain('AAPL &lt;b&gt;')
    expect(m.html).toContain('a &amp; b')
    expect(m.html).toContain('https://x.app/stock/AAPL')
    expect(m.text).toContain('[긴급]')
  })
})

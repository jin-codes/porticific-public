import { describe, expect, it } from 'vitest'
import { parseScope, toolAllowed } from '@/mcp/scope'
import { ACK_KEY, collectAlerts, kstDate, type AlertInput } from '@/lib/notify/digest'

describe('key scopes', () => {
  it('parses unknown values as full, as before', () => {
    expect(parseScope('analysis')).toBe('analysis')
    expect(parseScope('digest')).toBe('digest')
    expect(parseScope('full')).toBe('full')
    expect(parseScope('???')).toBe('full')
    expect(parseScope(undefined)).toBe('full')
  })
  it('lets a digest key call no MCP tool at all', () => {
    for (const t of ['portfolio_summary', 'record_buy', 'save_analysis', 'send_alerts', 'get_stock']) {
      expect(toolAllowed('digest', t)).toBe(false)
    }
  })
  it('keeps the analysis key limited to the analysis and thesis-review tools', () => {
    expect(toolAllowed('analysis', 'save_analysis')).toBe(true)
    expect(toolAllowed('analysis', 'save_thesis_check')).toBe(true)
    expect(toolAllowed('analysis', 'record_buy')).toBe(false)
    expect(toolAllowed('analysis', 'send_alerts')).toBe(false)
  })
  it('keeps full keys and OAuth tokens (no scope) unrestricted', () => {
    expect(toolAllowed('full', 'record_buy')).toBe(true)
    expect(toolAllowed(undefined, 'record_buy')).toBe(true)
  })
})

describe('ack keys', () => {
  const base: AlertInput = { today: '2026-10-16', checks: [], claimText: {}, thesisSince: '2026-10-09', signals: [], events: [], targets: [] }
  it('accepts every key collectAlerts can emit, and summary keys', () => {
    const alerts = collectAlerts({
      ...base,
      checks: [{ claim_id: '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab', ticker: 'AAPL', date: '2026-10-12', verdict: 'weakened', evidence: 'e' }],
      signals: [{ ticker: 'BRK.B', held: true, date: '2026-10-15', signal: 'sell', previous_signal: 'hold', reasoning: null }],
      events: [{ ticker: 'MSFT', event_date: '2026-10-17', kind: 'earnings', title: null }],
      targets: [{ ticker: 'X', price: 1, target_price: 2.5 }],
      moves: [{ ticker: 'RKLB', held: true, date: '2026-10-15', price: 40, change_pct: -10.8 }],
    })
    expect(alerts).toHaveLength(5)
    for (const a of alerts) expect(a.key).toMatch(ACK_KEY)
    expect('summary:2026-10-15').toMatch(ACK_KEY)
  })
  it('rejects keys that could collide with another channel or are malformed', () => {
    for (const k of ['kakao:thesis:x', 'thesis:', 'other:abc', 'thesis:a b', 'thesis:' + 'x'.repeat(200), '../etc']) {
      expect(k).not.toMatch(ACK_KEY)
    }
  })
})

describe('message budget', () => {
  it('accepts the per-message keys the sender acknowledges', () => {
    expect('msg:2026-10-16:165501-a3f9').toMatch(ACK_KEY)
    expect('msg:').not.toMatch(ACK_KEY)
  })
  it('counts the day in KST, so the budget resets at 15:00 UTC', () => {
    expect(kstDate(new Date('2026-10-16T14:59:59Z'))).toBe('2026-10-16')
    expect(kstDate(new Date('2026-10-16T15:00:00Z'))).toBe('2026-10-17')
    expect(kstDate(new Date('2026-10-16T00:00:00Z'))).toBe('2026-10-16')
  })
})

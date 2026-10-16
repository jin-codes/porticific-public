// Pure alert logic: decide what is worth an email and render it. No I/O, so it is unit-testable.

export const ALERT_KINDS = ['thesis', 'signal', 'event', 'target', 'price'] as const
/** What a user gets by default; price moves are chatty, so they are opt-in for the daily email. */
export const DEFAULT_KINDS: AlertKind[] = ['thesis', 'signal', 'event', 'target']
export const DEFAULT_MOVE_PCT = 5
export type AlertKind = (typeof ALERT_KINDS)[number]

export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  thesis: 'Thesis 주장 약화·붕괴',
  signal: '분석 신호 전환 (매도·축소·매수)',
  event: '실적·배당 일정 임박',
  target: '관심종목 목표가 도달',
  price: '가격 급변 (하루 등락 ±5% 이상)',
}

export interface Alert {
  /** Dedupe key stored in alert_log once the alert was emailed. */
  key: string
  kind: AlertKind
  ticker: string
  high: boolean
  /** price alerts: which way it moved */
  direction?: 'up' | 'down'
  title: string
  body: string
}

export interface ThesisCheckRow {
  claim_id: string
  ticker: string
  date: string
  verdict: string
  evidence: string
}

const SEVERITY: Record<string, number> = { intact: 0, weakened: 1, broken: 2 }
const VERDICT_KO: Record<string, string> = { weakened: '약화', broken: '붕괴' }
export const SIGNAL_KO: Record<string, string> = {
  trim: '비중축소', sell: '매도', urgent_sell: '긴급매도', buy: '매수',
}
const EVENT_KO: Record<string, string> = { earnings: '실적 발표', ex_dividend: '배당락' }

/** Signals that deserve an email, per kind of position. Everything else is routine. */
const HOLDING_ALERT_SIGNALS = new Set(['trim', 'sell', 'urgent_sell'])
const WATCH_ALERT_SIGNALS = new Set(['buy'])

export interface AlertInput {
  today: string
  /** Checks of the last weeks, any order; transitions are derived per claim. */
  checks: ThesisCheckRow[]
  claimText: Record<string, string>
  /** Only checks on/after this date can alert (older ones were someone else's news). */
  thesisSince: string
  signals: {
    ticker: string
    held: boolean
    date: string
    signal: string
    previous_signal: string | null
    reasoning: string | null
  }[]
  /** Earnings / ex-dividend rows for tracked tickers within the alert horizon. */
  events: { ticker: string; event_date: string; kind: string; title: string | null }[]
  /** Watchlist-only tickers with a target and a latest price. */
  targets: { ticker: string; price: number; target_price: number }[]
  /** Latest daily move per tracked ticker, for the 'price' kind. */
  moves?: { ticker: string; held: boolean; date: string; price: number; change_pct: number | null }[]
  /** Alert when |change| reaches this percent (default 5). A move of twice that alerts again. */
  movePct?: number
}

const clip = (s: string | null | undefined, n = 280) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : (s ?? ''))

/** A check alerts when the verdict is worse than the claim's previous verdict (or it is the first and already bad). */
export function thesisTransitions(checks: ThesisCheckRow[], since: string) {
  const byClaim = new Map<string, ThesisCheckRow[]>()
  for (const c of checks) byClaim.set(c.claim_id, [...(byClaim.get(c.claim_id) ?? []), c])
  const out: (ThesisCheckRow & { previous: string | null })[] = []
  for (const rows of byClaim.values()) {
    rows.sort((a, b) => a.date.localeCompare(b.date))
    rows.forEach((r, i) => {
      const prev = rows[i - 1]?.verdict ?? null
      if (r.date >= since && (SEVERITY[r.verdict] ?? 0) > (prev ? (SEVERITY[prev] ?? 0) : 0)) out.push({ ...r, previous: prev })
    })
  }
  return out
}

export function collectAlerts(i: AlertInput, kinds: readonly string[] = ALERT_KINDS): Alert[] {
  const on = new Set(kinds)
  const alerts: Alert[] = []

  if (on.has('thesis')) {
    for (const t of thesisTransitions(i.checks, i.thesisSince)) {
      alerts.push({
        key: `thesis:${t.claim_id}:${t.date}:${t.verdict}`,
        kind: 'thesis',
        ticker: t.ticker,
        high: t.verdict === 'broken',
        title: `${t.ticker} 주장 ${VERDICT_KO[t.verdict] ?? t.verdict}${t.previous ? ` (이전: ${t.previous === 'intact' ? '유효' : (VERDICT_KO[t.previous] ?? t.previous)})` : ''}`,
        body: `“${clip(i.claimText[t.claim_id] ?? '', 160)}”\n${clip(t.evidence)}`,
      })
    }
  }

  if (on.has('signal')) {
    for (const s of i.signals) {
      const set = s.held ? HOLDING_ALERT_SIGNALS : WATCH_ALERT_SIGNALS
      if (!set.has(s.signal) || s.previous_signal === s.signal) continue
      alerts.push({
        key: `signal:${s.ticker}:${s.date}:${s.signal}`,
        kind: 'signal',
        ticker: s.ticker,
        high: s.signal === 'urgent_sell' || s.signal === 'sell',
        title: `${s.ticker} 신호 ${s.previous_signal ? `${SIGNAL_KO[s.previous_signal] ?? s.previous_signal} → ` : ''}${SIGNAL_KO[s.signal]}`,
        body: clip(s.reasoning),
      })
    }
  }

  if (on.has('event')) {
    for (const e of i.events) {
      if (!EVENT_KO[e.kind]) continue
      const days = Math.round((Date.parse(e.event_date) - Date.parse(i.today)) / 86_400_000)
      if (days < 0) continue
      alerts.push({
        key: `event:${e.ticker}:${e.event_date}:${e.kind}`,
        kind: 'event',
        ticker: e.ticker,
        high: false,
        title: `${e.ticker} ${EVENT_KO[e.kind]} ${days === 0 ? '오늘' : `${days}일 후`} (${e.event_date})`,
        body: e.kind === 'earnings' ? '실적 발표 전후로 변동성이 커질 수 있습니다. 추가 매수 전에 Thesis를 다시 확인하세요.' : clip(e.title),
      })
    }
  }

  if (on.has('target')) {
    for (const t of i.targets) {
      if (!(t.price <= t.target_price)) continue
      alerts.push({
        key: `target:${t.ticker}:${t.target_price}`,
        kind: 'target',
        ticker: t.ticker,
        high: false,
        title: `${t.ticker} 목표가 도달`,
        body: `현재가 $${t.price.toFixed(2)} ≤ 목표가 $${t.target_price.toFixed(2)}`,
      })
    }
  }

  if (on.has('price')) {
    const th = i.movePct && i.movePct > 0 ? i.movePct : DEFAULT_MOVE_PCT
    for (const m of i.moves ?? []) {
      if (m.change_pct == null) continue
      const abs = Math.abs(m.change_pct)
      if (!(abs >= th)) continue
      const direction = m.change_pct > 0 ? 'up' : 'down'
      alerts.push({
        // the band makes a move that doubles the threshold alert once more; the same band never repeats
        key: `price:${m.ticker}:${m.date}:${direction}${Math.floor(abs / th)}`,
        kind: 'price',
        ticker: m.ticker,
        high: abs >= th * 2,
        direction,
        title: `${m.ticker} ${m.change_pct > 0 ? '+' : ''}${m.change_pct.toFixed(1)}% $${m.price.toFixed(2)}${m.held ? ' (보유)' : ''}`,
        body: `전일 대비 ${direction === 'up' ? '상승' : '하락'} (${m.date} 기준)`,
      })
    }
  }

  return alerts.sort((a, b) => Number(b.high) - Number(a.high) || a.ticker.localeCompare(b.ticker))
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function renderDigest(alerts: Alert[], opts: { date: string; siteUrl?: string }) {
  const high = alerts.filter((a) => a.high).length
  const subject = `[Porticific] 알림 ${alerts.length}건${high ? ` · 긴급 ${high}` : ''} (${opts.date})`
  const link = (t: string) => (opts.siteUrl ? `${opts.siteUrl.replace(/\/$/, '')}/stock/${encodeURIComponent(t)}` : null)

  const text =
    alerts.map((a) => `${a.high ? '[긴급] ' : ''}${a.title}\n${a.body}${link(a.ticker) ? `\n${link(a.ticker)}` : ''}`).join('\n\n') +
    '\n\n— 개인 기록이며 투자 조언이 아닙니다. 알림은 설정에서 끌 수 있습니다.'

  const items = alerts
    .map((a) => {
      const l = link(a.ticker)
      return `<tr><td style="padding:12px 0;border-top:1px solid #e5e5e5">
<div style="font-weight:600;color:${a.high ? '#b91c1c' : '#171717'}">${a.high ? '● ' : ''}${l ? `<a href="${esc(l)}" style="color:inherit">${esc(a.title)}</a>` : esc(a.title)}</div>
<div style="margin-top:4px;font-size:14px;line-height:1.5;color:#404040;white-space:pre-wrap">${esc(a.body)}</div></td></tr>`
    })
    .join('')
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:16px">
<h2 style="font-size:16px;margin:0 0 8px">Porticific 알림 · ${esc(opts.date)}</h2>
<table style="width:100%;border-collapse:collapse">${items}</table>
<p style="margin-top:16px;font-size:12px;color:#737373">개인 기록이며 투자 조언이 아닙니다. 알림은 설정에서 끌 수 있습니다.</p></div>`

  return { subject, text, html }
}

/** Keys a delivery bot may acknowledge: what collectAlerts() emits, plus `summary:<date>`. */
export const ACK_KEY = /^(thesis|signal|event|target|price|summary|msg):[A-Za-z0-9:._-]{1,120}$/
export const MAX_ACK_KEYS = 100

/** The delivery day for per-day message budgets: Kakao's daily quota resets at midnight KST. */
export function kstDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}

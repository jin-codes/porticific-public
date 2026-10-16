import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/lib/supabase/database.types'
import { getPriceProvider, type Quote } from '@/lib/prices'
import {
  buildSummary,
  estimateDcaBuys,
  dcaStartDate,
  groupByTag,
  normalizeTags,
  thesisHealth,
  type Signal,
  type Verdict,
} from './calc'
import { ALERT_KINDS, DEFAULT_KINDS, DEFAULT_MOVE_PCT, collectAlerts, kstDate, type Alert, type AlertInput } from '@/lib/notify/digest'

type Db = SupabaseClient<Database>
type Tables = Database['public']['Tables']
export type Holding = Tables['holdings']['Row']
export type WatchlistItem = Tables['watchlist']['Row']
export type AnalysisRow = Tables['daily_analysis']['Row']
export type ThesisClaim = Tables['thesis_claims']['Row']

/**
 * Every function takes a Ctx whose userId has ALREADY been verified by the
 * caller (session cookie or MCP token). The service-role client bypasses RLS,
 * so every per-user query below must filter by ctx.userId.
 */
export interface Ctx {
  db: Db
  userId: string
}

export function makeCtx(userId: string): Ctx {
  return { db: createAdminClient(), userId }
}

export class ServiceError extends Error {}

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new ServiceError(res.error.message)
  return res.data as T
}

const today = () => new Date().toISOString().slice(0, 10)
const up = (t: string) => t.trim().toUpperCase()

// ------------------------------------------------------------------- prices

/** Latest stored snapshot price per ticker (shared market data). */
export async function latestSnapshots(ctx: Ctx, tickers: string[]) {
  const out: Record<string, Tables['daily_snapshots']['Row']> = {}
  if (!tickers.length) return out
  // One round trip for the common case: recent rows for all tickers, newest first.
  const since = new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10)
  const recent = must(
    await ctx.db.from('daily_snapshots').select('*').in('ticker', tickers).gte('date', since).order('date', { ascending: false })
  )
  for (const r of recent) if (!out[r.ticker]) out[r.ticker] = r
  // Tickers with no snapshot in the window (stale/new) fall back to a per-ticker lookup.
  await Promise.all(
    tickers
      .filter((t) => !out[t])
      .map(async (t) => {
        const rows = must(
          await ctx.db.from('daily_snapshots').select('*').eq('ticker', t).order('date', { ascending: false }).limit(1)
        )
        if (rows[0]) out[t] = rows[0]
      })
  )
  return out
}

/** Daily closes for a ticker, oldest first (shared market data). */
export async function priceHistory(_ctx: Ctx, rawTicker: string, days = 120) {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days)
  const rows = must(
    await _ctx.db
      .from('daily_snapshots')
      .select('date,price')
      .eq('ticker', up(rawTicker))
      .gte('date', since.toISOString().slice(0, 10))
      .order('date')
  )
  return rows.map((r) => ({ date: r.date, price: r.price }))
}

/** live=true asks the price provider now (not stored); otherwise the last stored snapshot. */
export async function getPrices(ctx: Ctx, tickers: string[], live = true) {
  const list = [...new Set(tickers.map(up))]
  if (live) {
    const quotes = await getPriceProvider().quotes(list)
    const byTicker = new Map(quotes.map((q) => [q.ticker, q]))
    return list.map((t) => byTicker.get(t) ?? { ticker: t, error: 'no price data' })
  }
  const snaps = await latestSnapshots(ctx, list)
  return list.map((t) =>
    snaps[t]
      ? { ticker: t, price: snaps[t].price, changePct: snaps[t].change_pct, volume: snaps[t].volume, date: snaps[t].date }
      : { ticker: t, error: 'no stored snapshot' }
  )
}

/** Store quotes as today's daily snapshot + an intraday point. Shared market data: service role only. */
export async function storeQuotes(db: Db, quotes: Quote[]) {
  if (!quotes.length) return 0
  must(
    await db.from('daily_snapshots').upsert(
      quotes.map((q) => ({ ticker: q.ticker, date: q.date, price: q.price, change_pct: q.changePct, volume: q.volume })),
      { onConflict: 'ticker,date' }
    )
  )
  must(
    await db.from('intraday_snapshots').insert(
      quotes.map((q) => ({ ticker: q.ticker, price: q.price, change_pct: q.changePct, volume: q.volume }))
    ) as never
  )
  return quotes.length
}

// ------------------------------------------------------------------ holdings

export async function listHoldings(ctx: Ctx): Promise<Holding[]> {
  return must(await ctx.db.from('holdings').select('*').eq('user_id', ctx.userId).order('ticker'))
}

export async function listWatchlist(ctx: Ctx): Promise<WatchlistItem[]> {
  return must(await ctx.db.from('watchlist').select('*').eq('user_id', ctx.userId).order('ticker'))
}

export async function portfolioSummary(ctx: Ctx, opts: { live?: boolean } = {}) {
  const [holdings, trades, cash] = await Promise.all([
    listHoldings(ctx),
    ctx.db.from('trades').select('realized_pnl').eq('user_id', ctx.userId).then((r) => must(r)),
    cashBalance(ctx),
  ])
  const tickers = holdings.map((h) => h.ticker)
  const prices: Record<string, number | undefined> = {}
  if (opts.live) {
    for (const q of await getPriceProvider().quotes(tickers)) prices[q.ticker] = q.price
  }
  const snaps = await latestSnapshots(ctx, tickers.filter((t) => prices[t] === undefined))
  for (const [t, s] of Object.entries(snaps)) prices[t] = s.price
  const realized = trades.reduce((sum, t) => sum + (t.realized_pnl ?? 0), 0)
  return buildSummary(holdings, prices, realized, cash)
}

export async function getStock(ctx: Ctx, rawTicker: string, analysisDays = 5) {
  const ticker = up(rawTicker)
  const db = ctx.db
  const [holding, watch, snap, analysis, buys, trades, dca, events, claims] = await Promise.all([
    db.from('holdings').select('*').eq('user_id', ctx.userId).eq('ticker', ticker).maybeSingle(),
    db.from('watchlist').select('*').eq('user_id', ctx.userId).eq('ticker', ticker).maybeSingle(),
    db.from('daily_snapshots').select('*').eq('ticker', ticker).order('date', { ascending: false }).limit(1),
    db.from('daily_analysis').select('*').eq('user_id', ctx.userId).eq('ticker', ticker).order('date', { ascending: false }).limit(analysisDays),
    db.from('buys').select('*').eq('user_id', ctx.userId).eq('ticker', ticker).order('buy_date', { ascending: false }).limit(20),
    db.from('trades').select('*').eq('user_id', ctx.userId).eq('ticker', ticker).order('sell_date', { ascending: false }).limit(20),
    db.from('dca_plans').select('*').eq('user_id', ctx.userId).eq('ticker', ticker).maybeSingle(),
    db.from('market_events').select('ticker,event_date,kind,title').eq('ticker', ticker).gte('event_date', today()).order('event_date'),
    listClaims(ctx, { ticker }),
  ])
  return {
    ticker,
    holding: must(holding),
    watchlist: must(watch),
    latest_snapshot: must(snap)[0] ?? null,
    recent_analysis: must(analysis),
    buys: must(buys),
    trades: must(trades),
    dca_plan: must(dca),
    upcoming_events: must(events),
    thesis_claims: claims,
    thesis_health: thesisHealth(claims, today()),
  }
}

export async function setThesis(ctx: Ctx, rawTicker: string, thesis: string) {
  const ticker = up(rawTicker)
  const h = must(await ctx.db.from('holdings').update({ thesis }).eq('user_id', ctx.userId).eq('ticker', ticker).select())
  const w = must(await ctx.db.from('watchlist').update({ thesis }).eq('user_id', ctx.userId).eq('ticker', ticker).select())
  if (!h.length && !w.length) throw new ServiceError(`${ticker} is in neither holdings nor watchlist`)
  return { holdings: h, watchlist: w }
}

export async function setTags(ctx: Ctx, rawTicker: string, tags: string[]) {
  const ticker = up(rawTicker)
  const norm = normalizeTags(tags)
  const h = must(await ctx.db.from('holdings').update({ tags: norm }).eq('user_id', ctx.userId).eq('ticker', ticker).select())
  const w = must(await ctx.db.from('watchlist').update({ tags: norm }).eq('user_id', ctx.userId).eq('ticker', ticker).select())
  if (!h.length && !w.length) throw new ServiceError(`${ticker} is in neither holdings nor watchlist`)
  return { holdings: h, watchlist: w }
}

export async function upsertWatchlist(
  ctx: Ctx,
  rawTicker: string,
  fields: { target_price?: number | null; thesis?: string | null }
) {
  const row: Tables['watchlist']['Insert'] = { user_id: ctx.userId, ticker: up(rawTicker) }
  if (fields.target_price !== undefined) row.target_price = fields.target_price
  if (fields.thesis !== undefined) row.thesis = fields.thesis
  return must(await ctx.db.from('watchlist').upsert(row, { onConflict: 'user_id,ticker' }).select())
}

export async function removeFromWatchlist(ctx: Ctx, rawTicker: string) {
  return must(await ctx.db.from('watchlist').delete().eq('user_id', ctx.userId).eq('ticker', up(rawTicker)).select())
}

/** Overwrite holding fields WITHOUT a ledger row. Only for fixing wrong data. */
export async function correctHolding(
  ctx: Ctx,
  rawTicker: string,
  fields: { quantity?: number; avg_cost?: number; first_buy_date?: string }
) {
  const updates: Tables['holdings']['Update'] = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined)
  )
  if (!Object.keys(updates).length) throw new ServiceError('nothing to update')
  const rows = must(await ctx.db.from('holdings').update(updates).eq('user_id', ctx.userId).eq('ticker', up(rawTicker)).select())
  if (!rows.length) throw new ServiceError(`${up(rawTicker)} is not in holdings`)
  return rows
}

// -------------------------------------------------------------------- ledger

export async function recordBuy(
  ctx: Ctx,
  a: { ticker: string; quantity: number; price: number; date?: string; note?: string; source?: string; affect_cash?: boolean }
) {
  const res = await ctx.db.rpc('record_buy', {
    p_user_id: ctx.userId,
    p_ticker: a.ticker,
    p_quantity: a.quantity,
    p_price: a.price,
    p_date: a.date ?? today(),
    p_source: a.source ?? 'manual',
    p_affect_cash: a.affect_cash ?? true,
    ...(a.note !== undefined ? { p_note: a.note } : {}),
  })
  return must(res)
}

export async function recordSell(
  ctx: Ctx,
  a: { ticker: string; quantity: number; price: number; date?: string; note?: string; affect_cash?: boolean }
) {
  const res = await ctx.db.rpc('record_sell', {
    p_user_id: ctx.userId,
    p_ticker: a.ticker,
    p_quantity: a.quantity,
    p_price: a.price,
    p_date: a.date ?? today(),
    p_affect_cash: a.affect_cash ?? true,
    ...(a.note !== undefined ? { p_note: a.note } : {}),
  })
  return must(res)
}

// ---------------------------------------------------------------------- cash

/** Current cash balance, or null when cash tracking hasn't been started (no cash events yet). */
export async function cashBalance(ctx: Ctx): Promise<number | null> {
  const rows = must(await ctx.db.from('cash_events').select('amount').eq('user_id', ctx.userId))
  return rows.length ? rows.reduce((sum, r) => sum + r.amount, 0) : null
}

export async function listCashEvents(ctx: Ctx, limit = 30) {
  return must(
    await ctx.db
      .from('cash_events')
      .select('*')
      .eq('user_id', ctx.userId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)
  )
}

export async function getCash(ctx: Ctx, limit = 20) {
  return { balance: await cashBalance(ctx), currency: 'USD', recent_events: await listCashEvents(ctx, limit) }
}

export async function recordCashEvent(
  ctx: Ctx,
  a: { kind: 'deposit' | 'withdrawal' | 'dividend'; amount: number; date?: string; note?: string }
) {
  return must(
    await ctx.db.rpc('record_cash_event', {
      p_user_id: ctx.userId,
      p_kind: a.kind,
      p_amount: a.amount,
      p_date: a.date ?? today(),
      ...(a.note !== undefined ? { p_note: a.note } : {}),
    })
  )
}

/** Delete a manually entered cash event. Deleting the last manual one turns cash tracking off. */
export async function deleteCashEvent(ctx: Ctx, id: string) {
  return must(await ctx.db.rpc('delete_cash_event', { p_user_id: ctx.userId, p_id: id }))
}

/** Set the cash balance to an exact figure (records the difference as an adjustment). Starts cash tracking. */
export async function setCashBalance(ctx: Ctx, balance: number, opts: { date?: string; note?: string } = {}) {
  return must(
    await ctx.db.rpc('set_cash_balance', {
      p_user_id: ctx.userId,
      p_balance: balance,
      p_date: opts.date ?? today(),
      ...(opts.note !== undefined ? { p_note: opts.note } : {}),
    })
  )
}

export async function listTrades(ctx: Ctx, opts: { ticker?: string; limit?: number } = {}) {
  let q = ctx.db.from('trades').select('*').eq('user_id', ctx.userId)
  if (opts.ticker) q = q.eq('ticker', up(opts.ticker))
  return must(await q.order('sell_date', { ascending: false }).limit(opts.limit ?? 20))
}

export async function listBuys(ctx: Ctx, opts: { ticker?: string; limit?: number } = {}) {
  let q = ctx.db.from('buys').select('*').eq('user_id', ctx.userId)
  if (opts.ticker) q = q.eq('ticker', up(opts.ticker))
  return must(await q.order('buy_date', { ascending: false }).limit(opts.limit ?? 20))
}

// ----------------------------------------------------------------------- DCA

export async function listDcaPlans(ctx: Ctx) {
  return must(await ctx.db.from('dca_plans').select('*').eq('user_id', ctx.userId).order('ticker'))
}

export async function setDcaPlan(ctx: Ctx, rawTicker: string, amountKrw: number, fromDate: string) {
  return must(
    await ctx.db
      .from('dca_plans')
      .upsert(
        {
          user_id: ctx.userId,
          ticker: up(rawTicker),
          daily_amount_krw: amountKrw,
          start_date: fromDate,
          active: true,
          last_synced_date: null, // re-setting a plan restarts the catch-up window
        },
        { onConflict: 'user_id,ticker' }
      )
      .select()
  )
}

export async function stopDcaPlan(ctx: Ctx, rawTicker: string) {
  return must(await ctx.db.from('dca_plans').update({ active: false }).eq('user_id', ctx.userId).eq('ticker', up(rawTicker)).select())
}

/** Estimate the buys active DCA plans would have made; apply=true records them. */
export async function syncDca(ctx: Ctx, opts: { ticker?: string; apply?: boolean } = {}) {
  let q = ctx.db.from('dca_plans').select('*').eq('user_id', ctx.userId).eq('active', true)
  if (opts.ticker) q = q.eq('ticker', up(opts.ticker))
  const plans = must(await q)
  const provider = getPriceProvider()
  const end = today()
  const results = []
  for (const plan of plans) {
    const start = dcaStartDate(plan)
    if (start >= end) {
      results.push({ ticker: plan.ticker, status: 'up_to_date', buys: [] })
      continue
    }
    const fxStart = new Date(start + 'T00:00:00Z')
    fxStart.setUTCDate(fxStart.getUTCDate() - 7) // lets the first day forward-fill from the previous FX quote
    const [closes, fx] = await Promise.all([
      provider.dailyCloses(plan.ticker, start, end),
      provider.dailyCloses('KRW=X', fxStart.toISOString().slice(0, 10), end),
    ])
    const buys = estimateDcaBuys(plan, closes, fx, end)
    if (opts.apply && buys.length) {
      for (const b of buys) {
        await recordBuy(ctx, {
          ticker: plan.ticker,
          quantity: b.quantity,
          price: b.price,
          date: b.date,
          source: 'dca_estimate',
          note: `${plan.daily_amount_krw.toFixed(0)} KRW @ ${b.fx.toFixed(2)}`,
        })
      }
      must(
        await ctx.db
          .from('dca_plans')
          .update({ last_synced_date: buys[buys.length - 1].date })
          .eq('user_id', ctx.userId)
          .eq('ticker', plan.ticker)
          .select()
      )
    }
    results.push({
      ticker: plan.ticker,
      status: opts.apply ? 'applied' : 'dry_run',
      buys,
      estimated_shares: buys.reduce((s, b) => s + b.quantity, 0),
    })
  }
  return results
}

// ------------------------------------------------------------ events/analysis

export async function upcomingEvents(ctx: Ctx, days = 14) {
  const until = new Date()
  until.setUTCDate(until.getUTCDate() + days)
  return must(
    await ctx.db
      .from('market_events')
      .select('ticker,event_date,kind,title')
      .gte('event_date', today())
      .lte('event_date', until.toISOString().slice(0, 10))
      .order('event_date')
  )
}

export async function listAnalysis(ctx: Ctx, opts: { ticker?: string; date?: string; limit?: number } = {}) {
  let q = ctx.db.from('daily_analysis').select('*').eq('user_id', ctx.userId)
  if (opts.ticker) q = q.eq('ticker', up(opts.ticker))
  if (opts.date) q = q.eq('date', opts.date)
  return must(await q.order('date', { ascending: false }).limit(opts.limit ?? 20))
}

export async function listPortfolioAnalysis(ctx: Ctx, limit = 1) {
  return must(await ctx.db.from('portfolio_analysis').select('*').eq('user_id', ctx.userId).order('date', { ascending: false }).limit(limit))
}

export const HOLDING_SIGNALS = ['add_more', 'hold', 'watch', 'trim', 'sell', 'urgent_sell', 'avoid_chasing'] as const
export const WATCH_SIGNALS = ['buy', 'buy_wait', 'drop_watch'] as const

/** Everything the daily analysis needs, in one read: quotes are fetched now and stored as today's snapshot. */
export async function analysisContext(ctx: Ctx, opts: { maxTickers?: number } = {}) {
  const [holdings, watchlist, profile, events, previous, cash, claims] = await Promise.all([
    listHoldings(ctx),
    listWatchlist(ctx),
    getProfile(ctx),
    upcomingEvents(ctx, 14),
    listPortfolioAnalysis(ctx, 1),
    cashBalance(ctx),
    listClaims(ctx),
  ])
  const held = new Set(holdings.map((h) => h.ticker))
  const items = [
    ...holdings.map((h) => ({
      ticker: h.ticker,
      kind: 'holding' as const,
      thesis: h.thesis,
      position: { quantity: h.quantity, avg_cost: h.avg_cost, first_buy_date: h.first_buy_date },
      allowed_signals: [...HOLDING_SIGNALS],
    })),
    ...watchlist
      .filter((w) => !held.has(w.ticker))
      .map((w) => ({
        ticker: w.ticker,
        kind: 'watchlist' as const,
        thesis: w.thesis,
        position: { target_price: w.target_price },
        allowed_signals: [...WATCH_SIGNALS],
      })),
  ].slice(0, opts.maxTickers ?? 100)

  const quotes = new Map((await getPriceProvider().quotes(items.map((i) => i.ticker))).map((q) => [q.ticker, q]))
  await storeQuotes(ctx.db, [...quotes.values()])
  const prev = await latestAnalysisMap(ctx, items.map((i) => i.ticker))
  const date = [...quotes.values()].map((q) => q.date).sort().pop() ?? today()

  const invested = holdings.reduce((sum, h) => sum + h.quantity * (quotes.get(h.ticker)?.price ?? h.avg_cost), 0)
  return {
    date,
    investment_profile: profile,
    cash:
      cash == null
        ? null
        : { balance_usd: Math.round(cash * 100) / 100, pct_of_total_assets: invested + cash > 0 ? Math.round((cash / (invested + cash)) * 1000) / 10 : null },
    previous_portfolio_analysis: previous[0] ?? null,
    items: items.map((i) => ({
      ...i,
      price: quotes.get(i.ticker)?.price ?? null,
      change_pct: quotes.get(i.ticker)?.changePct ?? null,
      previous_analysis: prev[i.ticker] ? { date: prev[i.ticker].date, signal: prev[i.ticker].signal, reasoning: prev[i.ticker].reasoning } : null,
      upcoming_events: events.filter((e) => e.ticker === i.ticker),
      thesis_claims: claims
        .filter((c) => c.ticker === i.ticker)
        .map((c) => ({ claim: c.claim, kill_criteria: c.kill_criteria, status: c.status, last_checked: c.last_checked, last_evidence: c.last_evidence })),
    })),
  }
}

export async function saveAnalysis(
  ctx: Ctx,
  row: { ticker: string; date: string; price: number; change_pct?: number | null; signal: Signal; reasoning?: string | null }
) {
  // A holding must get a holdings signal; a watchlist-only ticker a watchlist signal.
  const t = up(row.ticker)
  const [h, w] = await Promise.all([
    ctx.db.from('holdings').select('ticker').eq('user_id', ctx.userId).eq('ticker', t).maybeSingle(),
    ctx.db.from('watchlist').select('ticker').eq('user_id', ctx.userId).eq('ticker', t).maybeSingle(),
  ])
  if (!h.data && !w.data) throw new ServiceError(`${t} is in neither holdings nor watchlist`)
  const allowed: readonly string[] = h.data ? HOLDING_SIGNALS : WATCH_SIGNALS
  if (!allowed.includes(row.signal)) {
    throw new ServiceError(`${t} is ${h.data ? 'held' : 'watchlist-only'}: signal must be one of ${allowed.join(', ')}`)
  }
  return must(
    await ctx.db
      .from('daily_analysis')
      .upsert({ ...row, ticker: up(row.ticker), user_id: ctx.userId }, { onConflict: 'user_id,ticker,date' })
      .select()
  )
}

export async function savePortfolioAnalysis(
  ctx: Ctx,
  row: { date: string; summary: string; top_pick?: string | null; top_pick_reason?: string | null }
) {
  if (row.top_pick) {
    const w = must(await ctx.db.from('watchlist').select('ticker').eq('user_id', ctx.userId).eq('ticker', up(row.top_pick)).maybeSingle())
    if (!w) throw new ServiceError(`top_pick ${up(row.top_pick)} is not on the watchlist`)
    row = { ...row, top_pick: up(row.top_pick) }
  }
  return must(
    await ctx.db.from('portfolio_analysis').upsert({ ...row, user_id: ctx.userId }, { onConflict: 'user_id,date' }).select()
  )
}

/** Most recent analysis row per ticker. */
export async function latestAnalysisMap(ctx: Ctx, tickers: string[]) {
  const out: Record<string, AnalysisRow> = {}
  if (!tickers.length) return out
  const list = tickers.map(up)
  // Recent window in one query; stragglers fall back to a per-ticker lookup.
  const since = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10)
  const recent = must(
    await ctx.db.from('daily_analysis').select('*').eq('user_id', ctx.userId).in('ticker', list).gte('date', since).order('date', { ascending: false })
  )
  for (const r of recent) if (!out[r.ticker]) out[r.ticker] = r
  await Promise.all(
    list
      .filter((t) => !out[t])
      .map(async (t) => {
        const rows = await listAnalysis(ctx, { ticker: t, limit: 1 })
        if (rows[0]) out[t] = rows[0]
      })
  )
  return out
}

// ------------------------------------------------------------- thesis claims

export const MAX_ACTIVE_CLAIMS = 12

async function assertTracked(ctx: Ctx, ticker: string) {
  const [h, w] = await Promise.all([
    ctx.db.from('holdings').select('ticker').eq('user_id', ctx.userId).eq('ticker', ticker).maybeSingle(),
    ctx.db.from('watchlist').select('ticker').eq('user_id', ctx.userId).eq('ticker', ticker).maybeSingle(),
  ])
  if (!h.data && !w.data) throw new ServiceError(`${ticker} is in neither holdings nor watchlist`)
}

export async function listClaims(ctx: Ctx, opts: { ticker?: string; includeInactive?: boolean } = {}): Promise<ThesisClaim[]> {
  let q = ctx.db.from('thesis_claims').select('*').eq('user_id', ctx.userId)
  if (opts.ticker) q = q.eq('ticker', up(opts.ticker))
  if (!opts.includeInactive) q = q.eq('active', true)
  return must(await q.order('ticker').order('created_at'))
}

/** Add falsifiable claims to a ticker's thesis. New claims start as 'unchecked'. */
export async function addClaims(ctx: Ctx, rawTicker: string, claims: { claim: string; kill_criteria?: string | null }[]) {
  const ticker = up(rawTicker)
  await assertTracked(ctx, ticker)
  const existing = await listClaims(ctx, { ticker })
  if (existing.length + claims.length > MAX_ACTIVE_CLAIMS) {
    throw new ServiceError(`${ticker} would have ${existing.length + claims.length} active claims; the limit is ${MAX_ACTIVE_CLAIMS}. Retire some first.`)
  }
  return must(
    await ctx.db
      .from('thesis_claims')
      .insert(claims.map((c) => ({ user_id: ctx.userId, ticker, claim: c.claim.trim(), kill_criteria: c.kill_criteria?.trim() || null })))
      .select()
  )
}

/** Edit a claim. Changing its wording or kill criteria invalidates the old verdict, so it goes back to 'unchecked'. */
export async function updateClaim(
  ctx: Ctx,
  id: string,
  patch: { claim?: string; kill_criteria?: string | null; active?: boolean }
) {
  const row: Tables['thesis_claims']['Update'] = {}
  if (patch.active !== undefined) row.active = patch.active
  if (patch.claim !== undefined || patch.kill_criteria !== undefined) {
    if (patch.claim !== undefined) row.claim = patch.claim.trim()
    if (patch.kill_criteria !== undefined) row.kill_criteria = patch.kill_criteria?.trim() || null
    Object.assign(row, { status: 'unchecked', last_checked: null, last_evidence: null })
  }
  if (!Object.keys(row).length) throw new ServiceError('nothing to update')
  const out = must(await ctx.db.from('thesis_claims').update(row).eq('user_id', ctx.userId).eq('id', id).select())
  if (!out.length) throw new ServiceError('claim not found')
  return out[0]
}

export async function deleteClaim(ctx: Ctx, id: string) {
  const out = must(await ctx.db.from('thesis_claims').delete().eq('user_id', ctx.userId).eq('id', id).select('id'))
  if (!out.length) throw new ServiceError('claim not found')
  return { deleted: id }
}

/** Record one verdict for a claim (history row + the claim's current status, atomically). */
export async function saveThesisCheck(ctx: Ctx, a: { claim_id: string; verdict: Verdict; evidence: string; date?: string }) {
  return must(
    await ctx.db.rpc('record_thesis_check', {
      p_user_id: ctx.userId,
      p_claim_id: a.claim_id,
      p_date: a.date ?? today(),
      p_verdict: a.verdict,
      p_evidence: a.evidence,
    })
  )
}

export async function listThesisChecks(ctx: Ctx, opts: { ticker?: string; claimId?: string; limit?: number } = {}) {
  let q = ctx.db.from('thesis_checks').select('*').eq('user_id', ctx.userId)
  if (opts.ticker) q = q.eq('ticker', up(opts.ticker))
  if (opts.claimId) q = q.eq('claim_id', opts.claimId)
  return must(await q.order('date', { ascending: false }).order('created_at', { ascending: false }).limit(opts.limit ?? 30))
}

/** Rolled-up thesis health per ticker (only tickers with active claims appear). */
export async function thesisHealthMap(ctx: Ctx, tickers?: string[]) {
  const claims = await listClaims(ctx)
  const by = new Map<string, ThesisClaim[]>()
  for (const c of claims) {
    if (tickers && !tickers.includes(c.ticker)) continue
    by.set(c.ticker, [...(by.get(c.ticker) ?? []), c])
  }
  return Object.fromEntries([...by].map(([t, cs]) => [t, thesisHealth(cs, today())]))
}

/**
 * Input for a thesis review: per ticker the thesis text, its claims with current status, the latest
 * price and recent checks. `tickers` defaults to everything held or watched that has claims.
 */
export async function thesisReviewContext(ctx: Ctx, opts: { ticker?: string } = {}) {
  const [holdings, watchlist, claims, events, profile] = await Promise.all([
    listHoldings(ctx),
    listWatchlist(ctx),
    listClaims(ctx, { ticker: opts.ticker }),
    upcomingEvents(ctx, 30),
    getProfile(ctx),
  ])
  const theses = new Map<string, { thesis: string | null; kind: 'holding' | 'watchlist'; position?: { quantity: number; avg_cost: number } }>()
  for (const w of watchlist) theses.set(w.ticker, { thesis: w.thesis, kind: 'watchlist' })
  for (const h of holdings) theses.set(h.ticker, { thesis: h.thesis, kind: 'holding', position: { quantity: h.quantity, avg_cost: h.avg_cost } })

  const tickers = [...new Set(claims.map((c) => c.ticker))].filter((t) => theses.has(t))
  const [snaps, checks] = await Promise.all([latestSnapshots(ctx, tickers), listThesisChecks(ctx, { limit: 200 })])
  return {
    date: today(),
    investment_profile: profile,
    items: tickers.map((t) => ({
      ticker: t,
      ...theses.get(t)!,
      price: snaps[t]?.price ?? null,
      change_pct: snaps[t]?.change_pct ?? null,
      upcoming_events: events.filter((e) => e.ticker === t),
      claims: claims
        .filter((c) => c.ticker === t)
        .map((c) => ({
          id: c.id,
          claim: c.claim,
          kill_criteria: c.kill_criteria,
          status: c.status,
          last_checked: c.last_checked,
          recent_checks: checks.filter((k) => k.claim_id === c.id).slice(0, 3).map((k) => ({ date: k.date, verdict: k.verdict, evidence: k.evidence })),
        })),
    })),
  }
}

// ------------------------------------------------------------------- reports

/** Holdings + watchlist grouped by tag or by latest analysis signal. */
export async function report(ctx: Ctx, kind: 'tags' | 'signals' | 'watchlist') {
  const [holdings, watchlist] = await Promise.all([listHoldings(ctx), listWatchlist(ctx)])
  const tickers = [...new Set([...holdings, ...watchlist].map((r) => r.ticker))]
  const snaps = await latestSnapshots(ctx, tickers)

  if (kind === 'watchlist') {
    return watchlist.map((w) => ({
      ticker: w.ticker,
      price: snaps[w.ticker]?.price ?? null,
      target_price: w.target_price,
      gap_to_target_pct:
        w.target_price && snaps[w.ticker] ? Math.round(((snaps[w.ticker].price - w.target_price) / w.target_price) * 10000) / 100 : null,
      tags: w.tags,
      thesis: w.thesis,
    }))
  }

  const holdingRows = holdings.map((h) => ({ ticker: h.ticker, quantity: h.quantity, avg_cost: h.avg_cost, price: snaps[h.ticker]?.price ?? null }))
  const watchRows = watchlist.map((w) => ({ ticker: w.ticker, target_price: w.target_price, price: snaps[w.ticker]?.price ?? null }))

  if (kind === 'tags') {
    const tagMap = (rows: { ticker: string; tags: string[] }[]) => Object.fromEntries(rows.map((r) => [r.ticker, r.tags]))
    return { holdings: groupByTag(holdingRows, tagMap(holdings)), watchlist: groupByTag(watchRows, tagMap(watchlist)) }
  }

  const latest = await latestAnalysisMap(ctx, tickers)
  const bySignal = <T extends { ticker: string }>(rows: T[]) => {
    const groups: Record<string, T[]> = {}
    for (const r of rows) (groups[latest[r.ticker]?.signal ?? '(no analysis)'] ??= []).push(r)
    return groups
  }
  return { holdings: bySignal(holdingRows), watchlist: bySignal(watchRows) }
}

// ------------------------------------------------------------------- profile

export async function getProfile(ctx: Ctx): Promise<string> {
  const res = await ctx.db.from('investment_profiles').select('*').eq('user_id', ctx.userId).maybeSingle()
  if (res.error) throw new ServiceError(res.error.message)
  return res.data?.content ?? ''
}

export async function setProfile(ctx: Ctx, content: string) {
  must(await ctx.db.from('investment_profiles').upsert({ user_id: ctx.userId, content }, { onConflict: 'user_id' }).select())
  return { ok: true }
}

// ------------------------------------------------------------- notifications

export async function getNotificationPrefs(ctx: Ctx) {
  const res = await ctx.db.from('notification_prefs').select('*').eq('user_id', ctx.userId).maybeSingle()
  if (res.error) throw new ServiceError(res.error.message)
  const row = res.data
  return { email_enabled: row?.email_enabled ?? false, email: row?.email ?? null, kinds: row?.kinds ?? [...DEFAULT_KINDS] }
}

export async function setNotificationPrefs(ctx: Ctx, p: { email_enabled?: boolean; email?: string | null; kinds?: string[] }) {
  const kinds = p.kinds?.filter((k): k is (typeof ALERT_KINDS)[number] => (ALERT_KINDS as readonly string[]).includes(k))
  must(
    await ctx.db
      .from('notification_prefs')
      .upsert(
        {
          user_id: ctx.userId,
          ...(p.email_enabled !== undefined ? { email_enabled: p.email_enabled } : {}),
          ...(p.email !== undefined ? { email: p.email?.trim() || null } : {}),
          ...(kinds ? { kinds } : {}),
        },
        { onConflict: 'user_id' }
      )
      .select()
  )
  return getNotificationPrefs(ctx)
}

/** Where alerts go: the override address, else the login email. */
export async function notificationEmail(ctx: Ctx): Promise<string | null> {
  const prefs = await getNotificationPrefs(ctx)
  if (prefs.email) return prefs.email
  const { data, error } = await ctx.db.auth.admin.getUserById(ctx.userId)
  if (error) throw new ServiceError(error.message)
  return data.user?.email ?? null
}

/** Gather everything collectAlerts() needs. Reads only; nothing is marked as sent here. */
export async function alertInput(ctx: Ctx, opts: { movePct?: number } = {}): Promise<AlertInput> {
  const now = today()
  const daysAgo = (n: number) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - n)
    return d.toISOString().slice(0, 10)
  }
  const [holdings, watchlist, claims, checks, events] = await Promise.all([
    listHoldings(ctx),
    listWatchlist(ctx),
    listClaims(ctx, { includeInactive: true }),
    must(await ctx.db.from('thesis_checks').select('claim_id,ticker,date,verdict,evidence').eq('user_id', ctx.userId).gte('date', daysAgo(90)).order('date').limit(2000)),
    upcomingEvents(ctx, 3),
  ])
  const held = new Set(holdings.map((h) => h.ticker))
  const watchOnly = watchlist.filter((w) => !held.has(w.ticker))
  const tracked = [...held, ...watchOnly.map((w) => w.ticker)]

  const [analysis, snaps] = await Promise.all([
    Promise.all(tracked.map((t) => listAnalysis(ctx, { ticker: t, limit: 2 }))),
    latestSnapshots(ctx, tracked),
  ])
  const signals = analysis
    .filter((rows) => rows[0] && rows[0].date >= daysAgo(3))
    .map((rows) => ({
      ticker: rows[0].ticker,
      held: held.has(rows[0].ticker),
      date: rows[0].date,
      signal: rows[0].signal,
      previous_signal: rows[1]?.signal ?? null,
      reasoning: rows[0].reasoning,
    }))

  return {
    today: now,
    checks,
    claimText: Object.fromEntries(claims.map((c) => [c.id, c.claim])),
    thesisSince: daysAgo(7),
    signals,
    events: events.filter((e) => tracked.includes(e.ticker)),
    movePct: opts.movePct ?? DEFAULT_MOVE_PCT,
    // a stale snapshot (weekend, holiday) was already alerted on its own day
    moves: tracked.flatMap((t) => (snaps[t] && snaps[t].date >= daysAgo(1) ? [{ ticker: t, held: held.has(t), date: snaps[t].date, price: snaps[t].price, change_pct: snaps[t].change_pct }] : [])),
    targets: watchOnly.flatMap((w) => (w.target_price != null && snaps[w.ticker] ? [{ ticker: w.ticker, price: snaps[w.ticker].price, target_price: w.target_price }] : [])),
  }
}

/**
 * alert_log keys are per delivery channel: email alerts use the plain key, other channels prefix it
 * (`kakao:thesis:…`), so sending one way never silences the other.
 */
const channelKey = (channel: string, key: string) => (channel ? `${channel}:${key}` : key)

async function sentKeys(ctx: Ctx, keys: string[], channel: string) {
  if (!keys.length) return new Set<string>()
  const rows = must(await ctx.db.from('alert_log').select('alert_key').eq('user_id', ctx.userId).in('alert_key', keys.map((k) => channelKey(channel, k))))
  return new Set(rows.map((r) => r.alert_key))
}

export async function unsentAlerts(ctx: Ctx, alerts: Alert[], channel = '') {
  const done = await sentKeys(ctx, alerts.map((a) => a.key), channel)
  return alerts.filter((a) => !done.has(channelKey(channel, a.key)))
}

export async function markKeysSent(ctx: Ctx, items: { key: string; message: string }[], channel = '') {
  if (!items.length) return
  must(
    await ctx.db
      .from('alert_log')
      .upsert(items.map((i) => ({ user_id: ctx.userId, alert_key: channelKey(channel, i.key), message: i.message })), { onConflict: 'user_id,alert_key', ignoreDuplicates: true })
      .select()
  )
}

export const markAlertsSent = (ctx: Ctx, alerts: Alert[], channel = '') =>
  markKeysSent(ctx, alerts.map((a) => ({ key: a.key, message: a.title })), channel)

/** What a delivery bot (the KakaoTalk sender) needs: the latest portfolio summary and the alerts it has not delivered yet. */
export async function digestPayload(ctx: Ctx, channel: string, opts: { movePct?: number } = {}) {
  const [input, latest] = await Promise.all([alertInput(ctx, opts), listPortfolioAnalysis(ctx, 1)])
  const alerts = await unsentAlerts(ctx, collectAlerts(input), channel)
  const s = latest[0]
  const key = s ? `summary:${s.date}` : null
  const summary = s && key
    ? {
        key,
        date: s.date,
        summary: s.summary,
        top_pick: s.top_pick,
        top_pick_reason: s.top_pick_reason,
        delivered: (await sentKeys(ctx, [key], channel)).size > 0,
      }
    : null
  // The sender acknowledges one `msg:<kst date>:<id>` key per message it delivered, so the daily budget
  // survives between its stateless runs.
  const kst = kstDate()
  const sent = await ctx.db
    .from('alert_log')
    .select('alert_key', { count: 'exact', head: true })
    .eq('user_id', ctx.userId)
    .like('alert_key', `${channelKey(channel, 'msg')}:${kst}:%`)
  if (sent.error) throw new ServiceError(sent.error.message)
  const messagesToday = sent.count ?? 0
  return { today: input.today, kst_date: kst, messages_today: messagesToday, summary, alerts }
}

/** Mark keys from a digest as delivered on a channel. Only keys this user could have been sent are accepted. */
export async function ackDigest(ctx: Ctx, keys: string[], channel: string) {
  const unique = [...new Set(keys)]
  await markKeysSent(ctx, unique.map((key) => ({ key, message: key })), channel)
  return { acknowledged: unique.length }
}

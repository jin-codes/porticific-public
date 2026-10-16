import { NextResponse } from 'next/server'
import { rejectUnlessCron } from '@/lib/cron'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPriceProvider } from '@/lib/prices'
import { storeQuotes } from '@/lib/portfolio/service'

export const maxDuration = 300

const EVENT_CONCURRENCY = 8

/** Run `fn` over items with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++])
    })
  )
}

/** Refresh stored prices + upcoming events for every ticker anyone holds or watches. */
export async function GET(req: Request) {
  const denied = rejectUnlessCron(req)
  if (denied) return denied

  const db = createAdminClient()
  const [h, w] = await Promise.all([db.from('holdings').select('ticker'), db.from('watchlist').select('ticker')])
  const tickers = [...new Set([...(h.data ?? []), ...(w.data ?? [])].map((r) => r.ticker))]

  const provider = getPriceProvider()
  const quotes = await provider.quotes(tickers)
  const stored = await storeQuotes(db, quotes)

  // Provider-sourced events are expected dates that can move: replace, don't merge.
  const today = new Date().toISOString().slice(0, 10)
  let events = 0
  await pool(tickers, EVENT_CONCURRENCY, async (ticker) => {
    const found = await provider.calendarEvents(ticker)
    await db.from('market_events').delete().eq('ticker', ticker).in('source', [provider.name, 'yfinance']).gte('event_date', today)
    if (found.length) {
      await db.from('market_events').upsert(
        found.map((e) => ({ ticker, event_date: e.date, kind: e.kind, title: e.title, source: provider.name })),
        { onConflict: 'ticker,event_date,kind' }
      )
      events += found.length
    }
  })
  return NextResponse.json({ tickers: tickers.length, quotes: stored, events })
}

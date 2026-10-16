import YahooFinance from 'yahoo-finance2'
import type { CalendarEvent, PriceProvider, Quote } from './types'

// Unofficial Yahoo Finance endpoints: no key, free, personal use only, and
// shared cloud IPs get rate-limited sometimes. Replace before serving other people.
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

const iso = (d: Date | number | string) => new Date(d).toISOString().slice(0, 10)

export const yahooProvider: PriceProvider = {
  name: 'yahoo',

  async quotes(tickers) {
    if (!tickers.length) return []
    const out: Quote[] = []
    // Per-ticker so one bad symbol doesn't fail the batch.
    await Promise.all(
      tickers.map(async (ticker) => {
        try {
          const q = await yf.quote(ticker)
          if (q?.regularMarketPrice == null) return
          out.push({
            ticker,
            price: q.regularMarketPrice,
            changePct: q.regularMarketChangePercent ?? null,
            volume: q.regularMarketVolume ?? null,
            date: iso(q.regularMarketTime ?? new Date()),
          })
        } catch {
          /* omitted: no data */
        }
      })
    )
    return out
  },

  async dailyCloses(ticker, from, to) {
    const res = await yf.chart(ticker, { period1: from, period2: to, interval: '1d' })
    const closes: Record<string, number> = {}
    for (const row of res.quotes ?? []) {
      if (row.close != null) closes[iso(row.date)] = row.close
    }
    return closes
  },

  async calendarEvents(ticker) {
    const events: CalendarEvent[] = []
    try {
      const res = await yf.quoteSummary(ticker, { modules: ['calendarEvents'] })
      const cal = res.calendarEvents
      for (const d of cal?.earnings?.earningsDate ?? []) {
        events.push({ date: iso(d), kind: 'earnings', title: `${ticker} earnings` })
      }
      if (cal?.exDividendDate) {
        events.push({ date: iso(cal.exDividendDate), kind: 'ex_dividend', title: `${ticker} ex-dividend` })
      }
    } catch {
      /* ETFs and unknown symbols have no calendar */
    }
    return events
  },
}

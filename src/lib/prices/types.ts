export interface Quote {
  ticker: string
  price: number
  changePct: number | null
  volume: number | null
  /** ISO date of the quote's trading day */
  date: string
}

export interface CalendarEvent {
  date: string
  kind: 'earnings' | 'ex_dividend'
  title: string
}

/**
 * Market-data source. Swap the implementation (see ./index.ts) to move to a
 * licensed provider; nothing outside src/lib/prices should know which one runs.
 */
export interface PriceProvider {
  readonly name: string
  /** Latest quotes; tickers with no data are omitted from the result. */
  quotes(tickers: string[]): Promise<Quote[]>
  /** Daily closes (ISO date -> close) for [from, to), both ISO dates. */
  dailyCloses(ticker: string, from: string, to: string): Promise<Record<string, number>>
  /** Upcoming earnings / ex-dividend dates; empty for ETFs etc. */
  calendarEvents(ticker: string): Promise<CalendarEvent[]>
}

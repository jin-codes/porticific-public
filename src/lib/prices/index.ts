import type { PriceProvider } from './types'
import { yahooProvider } from './yahoo'

export type { CalendarEvent, PriceProvider, Quote } from './types'

export function getPriceProvider(): PriceProvider {
  return yahooProvider
}

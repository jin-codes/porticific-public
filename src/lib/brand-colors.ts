// Approximate brand/logo colors per ticker, nudged where two brands collide (several blues, several
// reds) so neighbouring segments stay distinguishable. Tickers not listed get a stable fallback.
const BRAND: Record<string, string> = {
  AAPL: '#A3AAAE', MSFT: '#00A4EF', AMZN: '#FF9900', NVDA: '#76B900', AMD: '#ED1C24', TSLA: '#CC0000',
  AVGO: '#CC092F', INTC: '#0071C5', ORCL: '#F80000', NFLX: '#E50914', CRM: '#00A1E0', ASML: '#2D7FF9',
  QCOM: '#3253DC', ARM: '#0091BD', NOW: '#62D84E', SNOW: '#29B5E8', PANW: '#FA582D', CRWD: '#F04438',
  JPM: '#7C5A3A', GS: '#6CACE4', V: '#1A1F71', MA: '#EB001B', WMT: '#0071CE', COST: '#E31837',
  XOM: '#ED1B2D', UNH: '#002677', NVO: '#4DA6E0', GE: '#6D28D9', GEV: '#0EA5A5', CEG: '#14B8A6',
}

const FALLBACK = ['#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1']

export function brandColor(ticker: string): string {
  const known = BRAND[ticker.toUpperCase()]
  if (known) return known
  let h = 0
  for (const ch of ticker) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return FALLBACK[h % FALLBACK.length]
}

/** True for colors so dark they vanish on a dark background (pure black, navy): draw an outline. */
export function needsOutline(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return luminance < 0.06
}

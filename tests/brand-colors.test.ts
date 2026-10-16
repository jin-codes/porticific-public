import { describe, expect, it } from 'vitest'
import { brandColor, needsOutline } from '@/lib/brand-colors'

describe('brand colors', () => {
  it('uses the chosen brand colors for known tickers', () => {
    expect(brandColor('NVDA')).toBe('#76B900')
    expect(brandColor('AMZN')).toBe('#FF9900')
    expect(brandColor('NFLX')).toBe('#E50914')
  })
  it('is case-insensitive and gives unknown tickers a stable fallback', () => {
    expect(brandColor('nvda')).toBe(brandColor('NVDA'))
    expect(brandColor('ZZZZ')).toBe(brandColor('ZZZZ'))
  })
  it('outlines only colors that vanish on a dark background', () => {
    expect(needsOutline('#000000')).toBe(true)
    expect(needsOutline('#1E3A8A')).toBe(true)
    expect(needsOutline('#D1D5DB')).toBe(false)
    expect(needsOutline('#EA4335')).toBe(false)
  })
})

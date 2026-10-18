import { describe, expect, it } from 'vitest'
import { toolTitle } from '@/mcp/title'

describe('toolTitle', () => {
  it('turns snake_case names into readable titles', () => {
    expect(toolTitle('record_buy')).toBe('Record buy')
    expect(toolTitle('portfolio_summary')).toBe('Portfolio summary')
    expect(toolTitle('set_dca_plan')).toBe('Set DCA plan')
    expect(toolTitle('sync_dca')).toBe('Sync DCA')
  })
})

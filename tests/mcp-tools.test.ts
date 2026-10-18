import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

describe('MCP tool metadata (directory requirements)', () => {
  it('every tool has a title, annotations.title and a read-only or destructive hint', async () => {
    const { configureMcpServer } = await import('@/mcp/server')
    const tools: { name: string; config: { title: string; description: string; annotations: Record<string, unknown> } }[] = []
    configureMcpServer({ registerTool: (name: string, config: never) => void tools.push({ name, config }) } as never)

    expect(tools.length).toBeGreaterThan(40)
    for (const { name, config } of tools) {
      expect(name.length, name).toBeLessThanOrEqual(64)
      expect(config.title, name).toBeTruthy()
      expect(config.annotations.title, name).toBe(config.title)
      expect(config.annotations.readOnlyHint === true || 'destructiveHint' in config.annotations, name).toBe(true)
      // descriptions state what a tool does; they must not instruct Claude
      expect(config.description, name).not.toMatch(/\b(you must|factor it into|then call|always read|only write when)\b/i)
    }
  })
})

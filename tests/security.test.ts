import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { generateApiKey, sha256Hex, KEY_PREFIX } from '@/lib/mcp-key'
import { verifyPkce, requestOrigin, generateAccessToken, generateRefreshToken } from '@/mcp/oauth'
import { rejectUnlessCron } from '@/lib/cron'

describe('api keys', () => {
  it('generates prefixed random keys whose stored hash matches', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a.raw.startsWith(KEY_PREFIX)).toBe(true)
    expect(a.raw).not.toBe(b.raw)
    expect(a.hash).toBe(sha256Hex(a.raw))
    expect(a.prefix).toBe(a.raw.slice(0, 8))
    expect(a.hash).not.toContain(a.raw)
  })
})

describe('oauth', () => {
  it('verifies PKCE S256 and rejects a wrong verifier', () => {
    const verifier = 'a'.repeat(50)
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    expect(verifyPkce(verifier, challenge)).toBe(true)
    expect(verifyPkce(verifier + 'x', challenge)).toBe(false)
  })
  it('uses distinct prefixes so API keys and OAuth tokens cannot be confused', () => {
    expect(generateAccessToken().startsWith('prto_')).toBe(true)
    expect(generateRefreshToken().startsWith('prtr_')).toBe(true)
    expect(generateAccessToken().startsWith(KEY_PREFIX)).toBe(false)
  })
  it('derives the public origin from forwarded headers', () => {
    const req = new Request('http://localhost:3000/x', { headers: { 'x-forwarded-host': 'app.example.com', 'x-forwarded-proto': 'https' } })
    expect(requestOrigin(req)).toBe('https://app.example.com')
    expect(requestOrigin(new Request('http://localhost:3000/x'))).toBe('http://localhost:3000')
  })
})

describe('cron auth', () => {
  const original = process.env.CRON_SECRET
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = original
  })
  const req = (auth?: string) => new Request('http://x/api/cron/prices', { headers: auth ? { authorization: auth } : {} })

  it('refuses when no secret is configured', async () => {
    delete process.env.CRON_SECRET
    expect(rejectUnlessCron(req('Bearer anything'))?.status).toBe(503)
  })
  it('rejects missing or wrong bearer tokens and accepts the right one', () => {
    process.env.CRON_SECRET = 'topsecret'
    expect(rejectUnlessCron(req())?.status).toBe(401)
    expect(rejectUnlessCron(req('Bearer nope'))?.status).toBe(401)
    expect(rejectUnlessCron(req('Bearer topsecret1'))?.status).toBe(401)
    expect(rejectUnlessCron(req('Bearer topsecret'))).toBeNull()
  })
})

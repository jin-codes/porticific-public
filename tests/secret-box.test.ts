import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

describe('secret-box', () => {
  it('round-trips and rejects tampering', async () => {
    process.env.KEY_ENCRYPTION_SECRET = 'test-secret-with-enough-length'
    const { encryptSecret, decryptSecret } = await import('@/lib/secret-box')
    const blob = encryptSecret('sk-ant-example')
    expect(blob).not.toContain('sk-ant')
    expect(decryptSecret(blob)).toBe('sk-ant-example')
    expect(encryptSecret('sk-ant-example')).not.toBe(blob) // fresh IV each time
    const bad = Buffer.from(blob, 'base64url')
    bad[bad.length - 1] ^= 1
    expect(() => decryptSecret(bad.toString('base64url'))).toThrow()
  })

  it('refuses to work without a secret', async () => {
    process.env.KEY_ENCRYPTION_SECRET = ''
    const { encryptSecret, secretBoxConfigured } = await import('@/lib/secret-box')
    expect(secretBoxConfigured()).toBe(false)
    expect(() => encryptSecret('x')).toThrow()
  })
})

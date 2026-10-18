import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// AES-256-GCM for secrets at rest (users' own Anthropic keys). The key is derived from
// KEY_ENCRYPTION_SECRET; format: base64url(iv | tag | ciphertext).

function key(): Buffer {
  const secret = process.env.KEY_ENCRYPTION_SECRET
  if (!secret || secret.length < 16) throw new Error('KEY_ENCRYPTION_SECRET is not configured on the server')
  return createHash('sha256').update(secret).digest()
}

export const secretBoxConfigured = () => (process.env.KEY_ENCRYPTION_SECRET ?? '').length >= 16

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url')
}

export function decryptSecret(blob: string): string {
  const buf = Buffer.from(blob, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12))
  decipher.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8')
}

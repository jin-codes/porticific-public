import { createHash, randomBytes } from 'node:crypto'

export const KEY_PREFIX = 'prt_'

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** A new random key: shown to the user once; only its hash is stored. */
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = KEY_PREFIX + randomBytes(24).toString('base64url')
  return { raw, hash: sha256Hex(raw), prefix: raw.slice(0, 8) }
}

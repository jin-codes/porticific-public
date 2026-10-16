import { createHash, randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { sha256Hex } from '@/lib/mcp-key'

export const ALLOWED_SCOPES = ['portfolio:read', 'portfolio:write']

const randomToken = (prefix: string) => `${prefix}_${randomBytes(32).toString('hex')}`

export const generateAuthorizationCode = () => randomToken('prtc')
export const generateAccessToken = () => randomToken('prto')
export const generateRefreshToken = () => randomToken('prtr')
export const generateClientId = () => randomToken('prtcli')

/** RFC 7636 PKCE S256: base64url(sha256(code_verifier)) === code_challenge */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  return createHash('sha256').update(codeVerifier).digest('base64url') === codeChallenge
}

/** Origin as seen by the client (behind Vercel's proxy the forwarded headers carry it). */
export function requestOrigin(req: Request): string {
  const forwardedHost = req.headers.get('x-forwarded-host')
  const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'https'
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`
  return new URL(req.url).origin
}

export async function getOAuthClient(clientId: string) {
  const { data } = await createAdminClient()
    .from('mcp_oauth_clients')
    .select('client_id, redirect_uris, client_name')
    .eq('client_id', clientId)
    .maybeSingle()
  return data
}

export async function verifyOAuthAccessToken(rawToken: string) {
  const db = createAdminClient()
  const { data } = await db
    .from('mcp_oauth_tokens')
    .select('id, user_id, scope, expires_at, revoked_at')
    .eq('access_token_hash', sha256Hex(rawToken))
    .maybeSingle()

  if (!data || data.revoked_at) return null
  if (new Date(data.expires_at).getTime() < Date.now()) return null

  await db.from('mcp_oauth_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', data.id)
  return { userId: data.user_id, tokenId: data.id, scopes: (data.scope || '').split(' ').filter(Boolean) }
}

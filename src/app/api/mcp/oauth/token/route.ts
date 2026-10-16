import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sha256Hex } from '@/lib/mcp-key'
import { generateAccessToken, generateRefreshToken, verifyPkce } from '@/mcp/oauth'

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

async function parseBody(req: Request): Promise<Record<string, string>> {
  if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    return (await req.json().catch(() => ({}))) as Record<string, string>
  }
  const form = await req.formData().catch(() => null)
  return form ? (Object.fromEntries(form.entries()) as Record<string, string>) : {}
}

const tokenError = (error: string, description: string, status = 400) =>
  NextResponse.json({ error, error_description: description }, { status })

// One token endpoint for both the authorization_code and refresh_token grants.
export async function POST(req: Request) {
  const body = await parseBody(req)
  const db = createAdminClient()

  if (body.grant_type === 'authorization_code') {
    const { code, redirect_uri: redirectUri, client_id: clientId, code_verifier: codeVerifier } = body
    if (!code || !redirectUri || !clientId || !codeVerifier) {
      return tokenError('invalid_request', 'code, redirect_uri, client_id and code_verifier are required.')
    }

    const { data: codeRow } = await db.from('mcp_oauth_codes').select('*').eq('code_hash', sha256Hex(code)).maybeSingle()
    if (!codeRow || codeRow.used_at) return tokenError('invalid_grant', 'Invalid or already used code.')
    if (new Date(codeRow.expires_at).getTime() < Date.now()) return tokenError('invalid_grant', 'The code has expired.')
    if (codeRow.client_id !== clientId || codeRow.redirect_uri !== redirectUri) {
      return tokenError('invalid_grant', 'client_id or redirect_uri does not match.')
    }
    if (!verifyPkce(codeVerifier, codeRow.code_challenge)) {
      return tokenError('invalid_grant', 'code_verifier does not match the code_challenge.')
    }

    // A read-then-mark sequence would let two concurrent requests redeem the same code.
    // The conditional update (used_at is null) lets exactly one request claim it.
    const { data: claimed } = await db
      .from('mcp_oauth_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('id', codeRow.id)
      .is('used_at', null)
      .select('id')
    if (!claimed || claimed.length === 0) return tokenError('invalid_grant', 'Invalid or already used code.')

    return issueTokenResponse({ clientId, userId: codeRow.user_id, scope: codeRow.scope })
  }

  if (body.grant_type === 'refresh_token') {
    const { refresh_token: refreshToken, client_id: clientId } = body
    if (!refreshToken || !clientId) return tokenError('invalid_request', 'refresh_token and client_id are required.')

    const { data: tokenRow } = await db.from('mcp_oauth_tokens').select('*').eq('refresh_token_hash', sha256Hex(refreshToken)).maybeSingle()
    if (!tokenRow || tokenRow.revoked_at || tokenRow.client_id !== clientId) {
      return tokenError('invalid_grant', 'Invalid refresh_token.')
    }

    // Refresh tokens are single use too: claim with a conditional update (rotation without double issue).
    const { data: rotated } = await db
      .from('mcp_oauth_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', tokenRow.id)
      .is('revoked_at', null)
      .select('id')
    if (!rotated || rotated.length === 0) return tokenError('invalid_grant', 'Invalid refresh_token.')

    return issueTokenResponse({ clientId, userId: tokenRow.user_id, scope: tokenRow.scope })
  }

  return tokenError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.')
}

async function issueTokenResponse(p: { clientId: string; userId: string; scope: string | null }) {
  const accessToken = generateAccessToken()
  const refreshToken = generateRefreshToken()

  const { error } = await createAdminClient().from('mcp_oauth_tokens').insert({
    access_token_hash: sha256Hex(accessToken),
    refresh_token_hash: sha256Hex(refreshToken),
    client_id: p.clientId,
    user_id: p.userId,
    scope: p.scope,
    expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString(),
  })
  if (error) return tokenError('server_error', 'Failed to issue a token.', 500)

  return NextResponse.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: p.scope ?? undefined,
  })
}

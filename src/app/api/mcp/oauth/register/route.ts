import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateClientId } from '@/mcp/oauth'

const MAX_REDIRECT_URIS = 10
const FORBIDDEN_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:']

// https, http only on localhost/127.0.0.1, and custom schemes for desktop apps (e.g. claude://).
// javascript:/data: style schemes and URIs with a fragment can't be redirect targets (RFC 6749 §3.1.2).
function isValidRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (FORBIDDEN_SCHEMES.includes(url.protocol) || url.hash) return false
  if (url.protocol === 'http:') return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  return true
}

// Dynamic Client Registration (RFC 7591), public clients only. Connectors call this before authorize.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const redirectUris = body?.redirect_uris

  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > MAX_REDIRECT_URIS) {
    return NextResponse.json({ error: 'invalid_client_metadata', error_description: 'redirect_uris is required' }, { status: 400 })
  }
  if (!redirectUris.every(isValidRedirectUri)) {
    return NextResponse.json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris contains an unsupported or malformed URI' }, { status: 400 })
  }
  const clientName = typeof body?.client_name === 'string' ? body.client_name.trim().slice(0, 100) || null : null

  const clientId = generateClientId()
  const { error } = await createAdminClient()
    .from('mcp_oauth_clients')
    .insert({ client_id: clientId, redirect_uris: redirectUris, client_name: clientName })
  if (error) {
    return NextResponse.json({ error: 'server_error', error_description: 'failed to register client' }, { status: 500 })
  }

  return NextResponse.json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    client_name: clientName ?? undefined,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  })
}

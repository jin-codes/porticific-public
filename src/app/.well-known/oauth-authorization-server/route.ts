import { NextResponse } from 'next/server'
import { requestOrigin, ALLOWED_SCOPES } from '@/mcp/oauth'

// RFC 8414 discovery document for /api/mcp/oauth/*. Public clients only (PKCE, no client secret).
export async function GET(req: Request) {
  const origin = requestOrigin(req)
  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ALLOWED_SCOPES,
  })
}

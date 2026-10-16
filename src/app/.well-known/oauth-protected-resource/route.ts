import { NextResponse } from 'next/server'
import { requestOrigin } from '@/mcp/oauth'

// RFC 9728: withMcpAuth points 401 responses here so OAuth clients can find the authorization server.
export async function GET(req: Request) {
  const origin = requestOrigin(req)
  return NextResponse.json({ resource: `${origin}/api/mcp`, authorization_servers: [origin] })
}

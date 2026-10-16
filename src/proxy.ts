import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

export function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  // /auth/* (OAuth callback, sign-out) and /api/* (MCP, cron: own auth) are excluded.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|sitemap.xml|robots.txt|auth|api|\\.well-known).*)'],
}

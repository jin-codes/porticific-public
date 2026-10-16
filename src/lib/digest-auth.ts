import 'server-only'
import { NextResponse } from 'next/server'
import { verifyApiKey } from '@/mcp/auth'
import { makeCtx, type Ctx } from '@/lib/portfolio/service'

/** Bearer API key with scope 'digest' or 'full'. Returns the caller's ctx or an error response. */
export async function digestCtx(req: Request): Promise<Ctx | NextResponse> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '')
  const key = token ? await verifyApiKey(token) : null
  if (!key) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (key.scope === 'analysis') return NextResponse.json({ error: 'this key scope cannot read the digest' }, { status: 403 })
  return makeCtx(key.userId)
}

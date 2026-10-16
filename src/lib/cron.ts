import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

/** Returns an error response unless the request carries the CRON_SECRET bearer token. */
export function rejectUnlessCron(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '')
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return null
}

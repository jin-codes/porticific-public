import { NextResponse } from 'next/server'
import { digestCtx } from '@/lib/digest-auth'
import { digestPayload } from '@/lib/portfolio/service'

export const maxDuration = 30
const CHANNEL = /^[a-z]{2,12}$/

/**
 * Latest portfolio summary + alerts not yet delivered on a channel (default "kakao").
 * Read-only: nothing is marked delivered until POST /api/digest/ack.
 */
export async function GET(req: Request) {
  const ctx = await digestCtx(req)
  if (ctx instanceof NextResponse) return ctx
  const q = new URL(req.url).searchParams
  const channel = q.get('channel') ?? 'kakao'
  if (!CHANNEL.test(channel)) return NextResponse.json({ error: 'bad channel' }, { status: 400 })
  // price-move threshold in percent (default 5), kept sane so a typo cannot mute or flood the channel
  const movePct = q.has('move_pct') ? Number(q.get('move_pct')) : undefined
  if (movePct !== undefined && !(movePct >= 1 && movePct <= 50)) return NextResponse.json({ error: 'move_pct must be 1-50' }, { status: 400 })
  try {
    return NextResponse.json(await digestPayload(ctx, channel, { movePct }), { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}

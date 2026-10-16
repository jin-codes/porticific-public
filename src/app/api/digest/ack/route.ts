import { NextResponse } from 'next/server'
import { z } from 'zod'
import { digestCtx } from '@/lib/digest-auth'
import { ackDigest } from '@/lib/portfolio/service'
import { ACK_KEY, MAX_ACK_KEYS } from '@/lib/notify/digest'

export const maxDuration = 30

const body = z.object({
  channel: z.string().regex(/^[a-z]{2,12}$/).default('kakao'),
  keys: z.array(z.string().regex(ACK_KEY)).min(1).max(MAX_ACK_KEYS),
})

/** Mark summary / alert keys from GET /api/digest as delivered, so they are not offered again. */
export async function POST(req: Request) {
  const ctx = await digestCtx(req)
  if (ctx instanceof NextResponse) return ctx
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues.map((i) => i.message) }, { status: 400 })
  try {
    return NextResponse.json(await ackDigest(ctx, parsed.data.keys, parsed.data.channel))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}

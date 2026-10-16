import { NextResponse } from 'next/server'
import { rejectUnlessCron } from '@/lib/cron'
import { createAdminClient } from '@/lib/supabase/admin'
import { makeCtx } from '@/lib/portfolio/service'
import { runThesisCheck } from '@/lib/analysis/thesis'

export const maxDuration = 300

/** Weekly: re-check thesis claims for every user that has active claims. */
export async function GET(req: Request) {
  const denied = rejectUnlessCron(req)
  if (denied) return denied

  const { data } = await createAdminClient().from('thesis_claims').select('user_id').eq('active', true)
  const users = [...new Set((data ?? []).map((r) => r.user_id))]

  const results: Record<string, unknown> = {}
  for (const userId of users) {
    try {
      results[userId] = await runThesisCheck(makeCtx(userId))
    } catch (e) {
      results[userId] = { status: 'error', error: e instanceof Error ? e.message : String(e) }
    }
  }
  return NextResponse.json({ users: users.length, results })
}

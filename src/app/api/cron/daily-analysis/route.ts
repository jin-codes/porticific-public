import { NextResponse } from 'next/server'
import { rejectUnlessCron } from '@/lib/cron'
import { createAdminClient } from '@/lib/supabase/admin'
import { makeCtx } from '@/lib/portfolio/service'
import { runDailyAnalysis } from '@/lib/analysis/daily'

export const maxDuration = 300

/** Run the daily analysis for every user that holds or watches something. */
export async function GET(req: Request) {
  const denied = rejectUnlessCron(req)
  if (denied) return denied

  const db = createAdminClient()
  const [h, w] = await Promise.all([db.from('holdings').select('user_id'), db.from('watchlist').select('user_id')])
  const users = [...new Set([...(h.data ?? []), ...(w.data ?? [])].map((r) => r.user_id))]

  const results: Record<string, unknown> = {}
  for (const userId of users) {
    try {
      results[userId] = await runDailyAnalysis(makeCtx(userId))
    } catch (e) {
      results[userId] = { status: 'error', error: e instanceof Error ? e.message : String(e) }
    }
  }
  return NextResponse.json({ users: users.length, results })
}

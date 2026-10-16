import { NextResponse } from 'next/server'
import { rejectUnlessCron } from '@/lib/cron'
import { createAdminClient } from '@/lib/supabase/admin'
import { makeCtx } from '@/lib/portfolio/service'
import { sendAlerts } from '@/lib/notify/run'

export const maxDuration = 120

/** Email the daily alert digest to every user who turned alerts on. Runs after the analysis crons. */
export async function GET(req: Request) {
  const denied = rejectUnlessCron(req)
  if (denied) return denied

  const { data } = await createAdminClient().from('notification_prefs').select('user_id').eq('email_enabled', true)
  const users = (data ?? []).map((r) => r.user_id)

  const results: Record<string, unknown> = {}
  for (const userId of users) {
    try {
      results[userId] = await sendAlerts(makeCtx(userId))
    } catch (e) {
      results[userId] = { status: 'error', error: e instanceof Error ? e.message : String(e) }
    }
  }
  return NextResponse.json({ users: users.length, results })
}

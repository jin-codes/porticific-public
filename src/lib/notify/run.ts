import 'server-only'
import * as svc from '@/lib/portfolio/service'
import type { Ctx } from '@/lib/portfolio/service'
import { collectAlerts, renderDigest } from './digest'
import { sendEmail } from './email'

export interface AlertRun {
  status: 'sent' | 'nothing_new' | 'disabled' | 'skipped' | 'failed'
  reason?: string
  count?: number
  alerts?: string[]
}

/**
 * Email the user whatever is new since the last run. Alerts are logged as sent only after the
 * email went out, so a failed send is retried on the next run. dryRun lists what would be sent.
 */
export async function sendAlerts(ctx: Ctx, opts: { dryRun?: boolean } = {}): Promise<AlertRun> {
  const prefs = await svc.getNotificationPrefs(ctx)
  if (!prefs.email_enabled) return { status: 'disabled' }

  const input = await svc.alertInput(ctx)
  const fresh = await svc.unsentAlerts(ctx, collectAlerts(input, prefs.kinds))
  if (!fresh.length) return { status: 'nothing_new' }
  if (opts.dryRun) return { status: 'nothing_new', reason: 'dry run', count: fresh.length, alerts: fresh.map((a) => a.title) }

  const to = await svc.notificationEmail(ctx)
  if (!to) return { status: 'skipped', reason: 'no email address on the account' }

  const mail = renderDigest(fresh, { date: input.today, siteUrl: process.env.NEXT_PUBLIC_SITE_URL })
  const res = await sendEmail({ to, ...mail })
  if (res.status !== 'sent') return { status: res.status, reason: res.reason, count: fresh.length }
  await svc.markAlertsSent(ctx, fresh)
  return { status: 'sent', count: fresh.length, alerts: fresh.map((a) => a.title) }
}

/** A fixed sample mail so the user can check delivery without waiting for a real alert. Not logged. */
export async function sendTestEmail(ctx: Ctx) {
  const to = await svc.notificationEmail(ctx)
  if (!to) return { status: 'skipped' as const, reason: 'no email address on the account' }
  const mail = renderDigest(
    [{ key: 'test', kind: 'thesis', ticker: 'TEST', high: false, title: '테스트 알림입니다', body: '이 메일이 보이면 알림 설정이 정상입니다.' }],
    { date: new Date().toISOString().slice(0, 10), siteUrl: process.env.NEXT_PUBLIC_SITE_URL }
  )
  return { ...(await sendEmail({ to, ...mail })), to }
}

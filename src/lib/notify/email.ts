import 'server-only'
import nodemailer from 'nodemailer'

export interface EmailResult {
  status: 'sent' | 'skipped' | 'failed'
  reason?: string
}

/**
 * Send through SMTP. Free option: a Gmail account with 2-Step Verification and an app password
 * (ALERT_SMTP_USER = the Gmail address, ALERT_SMTP_PASS = the 16-character app password, no spaces).
 * Without both, nothing is sent.
 */
export async function sendEmail(msg: { to: string; subject: string; html: string; text: string }): Promise<EmailResult> {
  const user = process.env.ALERT_SMTP_USER
  const pass = process.env.ALERT_SMTP_PASS
  if (!user || !pass) return { status: 'skipped', reason: 'ALERT_SMTP_USER / ALERT_SMTP_PASS are not set on the server' }

  const port = Number(process.env.ALERT_SMTP_PORT ?? 465)
  const transport = nodemailer.createTransport({
    host: process.env.ALERT_SMTP_HOST ?? 'smtp.gmail.com',
    port,
    secure: port === 465, // implicit TLS on 465; other ports upgrade via STARTTLS
    requireTLS: port !== 465,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  try {
    const info = await transport.sendMail({
      from: process.env.ALERT_FROM ?? `Porticific <${user}>`,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    })
    if (info.rejected?.length) return { status: 'failed', reason: 'recipient rejected by SMTP server' }
    if (info.accepted && info.accepted.length === 0) return { status: 'failed', reason: 'SMTP server accepted no recipients' }
    return { status: 'sent' }
  } catch (e) {
    return { status: 'failed', reason: e instanceof Error ? e.message : String(e) }
  } finally {
    transport.close()
  }
}

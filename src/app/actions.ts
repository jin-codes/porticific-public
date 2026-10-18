'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireCtx } from '@/lib/auth'
import * as svc from '@/lib/portfolio/service'
import { getPriceProvider } from '@/lib/prices'
import { runDailyAnalysis } from '@/lib/analysis/daily'
import { proposeClaims, runThesisCheck } from '@/lib/analysis/thesis'
import { sendAlerts, sendTestEmail } from '@/lib/notify/run'
import { ALERT_KINDS } from '@/lib/notify/digest'
import { generateApiKey } from '@/lib/mcp-key'
import { deleteUserAnthropicKey, saveUserAnthropicKey } from '@/lib/analysis/credentials'

export type ActionState = { ok?: boolean; error?: string; message?: string; secret?: string } | undefined

const ticker = z.string().trim().min(1).max(15).transform((s) => s.toUpperCase())
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const num = z.coerce.number()
const optionalDate = z.preprocess((v) => (v === '' ? undefined : v), isoDate.optional())
const optionalText = z.preprocess((v) => (v === '' ? undefined : v), z.string().max(500).optional())
const optionalNum = z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().optional())

async function run(fn: () => Promise<string | void>, paths: string[]): Promise<ActionState> {
  try {
    const message = await fn()
    for (const p of paths) revalidatePath(p)
    return { ok: true, message: message ?? undefined }
  } catch (e) {
    if (e instanceof z.ZodError) return { error: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

const f = (fd: FormData) => Object.fromEntries(fd.entries())
/** Buy/sell forms carry a "현금에 반영하지 않기" checkbox named no_cash; unchecked (absent) means cash follows the trade. */
const affectCash = (fd: FormData) => fd.get('no_cash') !== 'on'

export async function buyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const a = z.object({ ticker, quantity: num.positive(), price: num.min(0), date: optionalDate, note: optionalText }).parse(f(fd))
    await svc.recordBuy(ctx, { ...a, affect_cash: affectCash(fd) })
    return `${a.ticker} 매수를 기록했습니다.`
  }, ['/', '/trades'])
}

export async function sellAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const a = z.object({ ticker, quantity: num.positive(), price: num.min(0), date: optionalDate, note: optionalText }).parse(f(fd))
    await svc.recordSell(ctx, { ...a, affect_cash: affectCash(fd) })
    return `${a.ticker} 매도를 기록했습니다.`
  }, ['/', '/trades'])
}

export async function thesisAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const a = z.object({ ticker, thesis: z.string().max(20000) }).parse(f(fd))
    await svc.setThesis(ctx, a.ticker, a.thesis)
    return '저장했습니다.'
  }, ['/', '/watchlist'])
}

export async function tagsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const a = z.object({ ticker, tags: z.string().max(400) }).parse(f(fd))
    await svc.setTags(ctx, a.ticker, a.tags.split(','))
    return '태그를 저장했습니다.'
  }, ['/', '/watchlist'])
}

export async function watchlistAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const a = z.object({ ticker, target_price: optionalNum, thesis: optionalText }).parse(f(fd))
    await svc.upsertWatchlist(ctx, a.ticker, { target_price: a.target_price, thesis: a.thesis })
    return `${a.ticker}을(를) 관심종목에 저장했습니다.`
  }, ['/watchlist'])
}

export async function removeWatchlistAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const a = z.object({ ticker }).parse(f(fd))
    await svc.removeFromWatchlist(ctx, a.ticker)
  }, ['/watchlist'])
}

export async function dcaPlanAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const a = z.object({ ticker, amount_krw: num.positive(), from_date: isoDate }).parse(f(fd))
    await svc.setDcaPlan(ctx, a.ticker, a.amount_krw, a.from_date)
    return 'DCA 계획을 저장했습니다.'
  }, ['/settings', `/stock/${fd.get('ticker')}`])
}

export async function stopDcaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const a = z.object({ ticker }).parse(f(fd))
    await svc.stopDcaPlan(ctx, a.ticker)
  }, ['/settings'])
}

export async function syncDcaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const apply = fd.get('apply') === '1'
    const results = await svc.syncDca(ctx, { apply })
    const n = results.reduce((s, r) => s + r.buys.length, 0)
    return apply ? `추정 매수 ${n}건을 기록했습니다.` : `추정 매수 ${n}건 (미리보기, 아직 기록 안 됨)`
  }, ['/', '/settings', '/trades'])
}

export async function profileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const a = z.object({ content: z.string().max(20000) }).parse(f(fd))
    await svc.setProfile(ctx, a.content)
    return '투자 성향을 저장했습니다.'
  }, ['/settings'])
}

export async function refreshPricesAction(): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const [h, w] = await Promise.all([svc.listHoldings(ctx), svc.listWatchlist(ctx)])
    const tickers = [...new Set([...h, ...w].map((r) => r.ticker))]
    const n = await svc.storeQuotes(ctx.db, await getPriceProvider().quotes(tickers))
    return n === tickers.length ? `${n}개 종목 시세를 갱신했습니다.` : `${tickers.length}개 중 ${n}개 종목만 갱신됐습니다 (시세 제공처 응답 없음).`
  }, ['/', '/watchlist'])
}

export async function runAnalysisAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const { tickers } = z.object({ tickers: z.string().max(300).optional() }).parse(f(fd))
    const list = (tickers ?? '').split(/[\s,]+/).filter(Boolean)
    const r = await runDailyAnalysis(ctx, { tickers: list })
    if (r.status === 'skipped') return `건너뜀: ${r.reason}`
    return `분석 ${r.analyzed?.length ?? 0}건 완료` + (r.failed?.length ? `, 실패 ${r.failed.length}건` : '')
  }, ['/', '/watchlist'])
}

export async function saveAnthropicKeyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const { key } = z.object({ key: z.string().max(300) }).parse(f(fd))
    await saveUserAnthropicKey(ctx, key)
    return '키를 저장했습니다. 이제 분석은 내 키로 실행됩니다.'
  }, ['/settings'])
}

export async function deleteAnthropicKeyAction(): Promise<ActionState> {
  return run(async () => {
    await deleteUserAnthropicKey(await requireCtx())
    return '키를 삭제했습니다.'
  }, ['/settings'])
}

export async function createApiKeyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx()
    const { name, scope } = z
      .object({ name: z.string().trim().min(1).max(60), scope: z.enum(['full', 'analysis', 'digest']).default('full') })
      .parse(f(fd))
    const key = generateApiKey()
    const { error } = await ctx.db.from('mcp_api_keys').insert({ user_id: ctx.userId, key_hash: key.hash, key_prefix: key.prefix, name, scope })
    if (error) throw new Error(error.message)
    revalidatePath('/settings')
    return { ok: true, secret: key.raw, message: '지금 복사하세요. 다시 볼 수 없습니다.' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export async function revokeApiKeyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const { id } = z.object({ id: z.string().uuid() }).parse(f(fd))
    const { error } = await ctx.db
      .from('mcp_api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', ctx.userId)
    if (error) throw new Error(error.message)
  }, ['/settings'])
}

export async function revokeOAuthClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const { client_id } = z.object({ client_id: z.string().min(1).max(200) }).parse(f(fd))
    const { error } = await ctx.db
      .from('mcp_oauth_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', ctx.userId)
      .eq('client_id', client_id)
      .is('revoked_at', null)
    if (error) throw new Error(error.message)
    return '연결을 해제했습니다.'
  }, ['/settings'])
}

export async function cashEventAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const a = z
      .object({ kind: z.enum(['deposit', 'withdrawal', 'dividend']), amount: num.positive(), date: optionalDate, note: optionalText })
      .parse(f(fd))
    await svc.recordCashEvent(ctx, a)
    return '현금 내역을 기록했습니다.'
  }, ['/', '/trades'])
}

export async function setCashBalanceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const a = z.object({ balance: num.min(0), date: optionalDate, note: optionalText }).parse(f(fd))
    await svc.setCashBalance(ctx, a.balance, a)
    return '현금 잔고를 설정했습니다.'
  }, ['/', '/trades'])
}

export async function deleteCashEventAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const { id } = z.object({ id: z.string().uuid() }).parse(f(fd))
    const r = (await svc.deleteCashEvent(ctx, id)) as { tracking_reset?: boolean }
    return r.tracking_reset ? '삭제했습니다. 현금 기록이 모두 없어져 추적이 꺼졌습니다.' : '삭제했습니다.'
  }, ['/', '/trades'])
}

const stockPath = (fd: FormData) => `/stock/${encodeURIComponent(String(fd.get('ticker') ?? ''))}`

export async function addClaimAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const a = z.object({ ticker, claim: z.string().trim().min(1).max(500), kill_criteria: optionalText }).parse(f(fd))
    await svc.addClaims(ctx, a.ticker, [{ claim: a.claim, kill_criteria: a.kill_criteria }])
    return '주장을 추가했습니다.'
  }, [stockPath(fd), '/'])
}

export async function updateClaimAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const a = z.object({ id: z.string().uuid(), claim: z.string().trim().min(1).max(500), kill_criteria: z.string().max(500).default('') }).parse(f(fd))
    await svc.updateClaim(ctx, a.id, { claim: a.claim, kill_criteria: a.kill_criteria })
    return '수정했습니다. 판정은 미점검으로 돌아갑니다.'
  }, [stockPath(fd), '/'])
}

export async function retireClaimAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const { id } = z.object({ id: z.string().uuid() }).parse(f(fd))
    await svc.updateClaim(ctx, id, { active: false })
  }, [stockPath(fd), '/'])
}

export async function deleteClaimAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const { id } = z.object({ id: z.string().uuid() }).parse(f(fd))
    await svc.deleteClaim(ctx, id)
  }, [stockPath(fd), '/'])
}

export async function proposeClaimsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const a = z.object({ ticker }).parse(f(fd))
    const r = await proposeClaims(ctx, a.ticker)
    if (r.status === 'skipped') return `건너뜀: ${r.reason}`
    return `주장 ${r.claims.length}개를 추출했습니다. 내용을 확인하고 다듬어 주세요.`
  }, [stockPath(fd)])
}

export async function runThesisCheckAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const a = z.object({ ticker: ticker.optional() }).parse(f(fd))
    const r = await runThesisCheck(ctx, { ticker: a.ticker })
    if (r.status === 'skipped') return `건너뜀: ${r.reason}`
    const bad = r.checked?.filter((c) => c.verdict !== 'intact').length ?? 0
    return `주장 ${r.checked?.length ?? 0}건 점검 (약화·붕괴 ${bad}건)` + (r.unassessed?.length ? `, 판단 불가 ${r.unassessed.length}건` : '') + (r.failed?.length ? `, 실패 ${r.failed.length}건` : '')
  }, [stockPath(fd), '/'])
}

export async function notificationPrefsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const a = z.object({ email: z.union([z.literal(''), z.string().trim().email().max(254)]) }).parse(f(fd))
    const kinds = ALERT_KINDS.filter((k) => fd.get(`kind_${k}`) === 'on')
    await svc.setNotificationPrefs(ctx, { email_enabled: fd.get('email_enabled') === 'on', email: a.email || null, kinds })
    return '알림 설정을 저장했습니다.'
  }, ['/settings'])
}

export async function sendTestEmailAction(): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const r = await sendTestEmail(ctx)
    if (r.status === 'sent') return `${r.to}로 테스트 메일을 보냈습니다.`
    throw new Error(r.reason ?? r.status)
  }, [])
}

export async function sendAlertsNowAction(): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireCtx()
    const r = await sendAlerts(ctx)
    if (r.status === 'sent') return `알림 ${r.count}건을 메일로 보냈습니다.`
    if (r.status === 'nothing_new') return '새로 보낼 알림이 없습니다.'
    if (r.status === 'disabled') return '이메일 알림이 꺼져 있습니다. 먼저 켜고 저장하세요.'
    throw new Error(r.reason ?? r.status)
  }, [])
}

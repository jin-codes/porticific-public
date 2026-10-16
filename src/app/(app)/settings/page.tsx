import { requireCtx } from '@/lib/auth'
import * as svc from '@/lib/portfolio/service'
import { num } from '@/lib/format'
import { ALERT_KINDS, ALERT_KIND_LABEL } from '@/lib/notify/digest'
import { Card, inputCls } from '@/components/ui'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import {
  createApiKeyAction,
  dcaPlanAction,
  notificationPrefsAction,
  profileAction,
  revokeApiKeyAction,
  revokeOAuthClientAction,
  runAnalysisAction,
  sendAlertsNowAction,
  sendTestEmailAction,
  stopDcaAction,
  syncDcaAction,
} from '@/app/actions'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const ctx = await requireCtx()
  const [profile, notif, plans, keys, oauth] = await Promise.all([
    svc.getProfile(ctx),
    svc.getNotificationPrefs(ctx),
    svc.listDcaPlans(ctx),
    ctx.db.from('mcp_api_keys').select('id,name,key_prefix,scope,created_at,last_used_at,revoked_at').eq('user_id', ctx.userId).order('created_at', { ascending: false }),
    ctx.db
      .from('mcp_oauth_tokens')
      .select('client_id, created_at, last_used_at, revoked_at')
      .eq('user_id', ctx.userId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false }),
  ])
  // one row per connected app (the newest live token)
  const clientIds = [...new Set((oauth.data ?? []).map((t) => t.client_id))]
  const clientRows = clientIds.length
    ? ((await ctx.db.from('mcp_oauth_clients').select('client_id, client_name').in('client_id', clientIds)).data ?? [])
    : []
  const clientName = new Map(clientRows.map((c) => [c.client_id, c.client_name]))
  const apps = new Map<string, { name: string; last: string | null }>()
  for (const t of oauth.data ?? []) {
    if (!apps.has(t.client_id)) apps.set(t.client_id, { name: clientName.get(t.client_id) ?? '이름 없는 앱', last: t.last_used_at })
  }
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://<your-domain>'

  return (
    <>
      <h1 className="text-xl font-semibold">설정</h1>

      <Card title="투자 성향 (분석에 항상 반영됩니다)">
        <ActionForm action={profileAction} submit="저장" className="space-y-2">
          <textarea name="content" defaultValue={profile} rows={10} className={inputCls} placeholder="위험 허용도, 투자 기간, 집중 기준, 분석 언어 등" />
        </ActionForm>
      </Card>

      <Card title="이메일 알림">
        <p className="mb-3 text-sm text-neutral-500">
          매일 한 통의 요약 메일로, 새로 생긴 알림만 보냅니다. 서버에 ALERT_SMTP_USER / ALERT_SMTP_PASS(Gmail 앱 비밀번호)가 있어야 발송됩니다.
        </p>
        <ActionForm action={notificationPrefsAction} submit="저장" className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="email_enabled" defaultChecked={notif.email_enabled} /> 이메일 알림 켜기
          </label>
          <div>
            <label className="block text-xs text-neutral-500">받는 주소 (비우면 로그인 이메일)</label>
            <input name="email" type="email" defaultValue={notif.email ?? ''} className={inputCls} placeholder="you@example.com" />
          </div>
          <fieldset className="space-y-1">
            <legend className="text-xs text-neutral-500">받을 알림</legend>
            {ALERT_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`kind_${k}`} defaultChecked={notif.kinds.includes(k)} /> {ALERT_KIND_LABEL[k]}
              </label>
            ))}
          </fieldset>
        </ActionForm>
        <div className="mt-3 flex flex-wrap gap-4">
          <ActionButton action={sendTestEmailAction} label="테스트 메일 보내기" />
          <ActionButton action={sendAlertsNowAction} label="지금 알림 확인·발송" />
        </div>
      </Card>

      <Card title="일일 분석">
        <p className="mb-3 text-sm text-neutral-500">
          평일 장 마감 후 자동 실행됩니다. 서버에 ANTHROPIC_API_KEY가 없으면 건너뜁니다.
        </p>
        <ActionButton action={runAnalysisAction} label="지금 분석 실행" />
      </Card>

      <Card title="DCA 계획 (매일 원화 정액 매수)">
        {plans.length > 0 && (
          <ul className="mb-4 space-y-1 text-sm">
            {plans.map((p) => (
              <li key={p.ticker} className="flex items-center gap-3">
                <span className="w-16 font-medium">{p.ticker}</span>
                <span className="tabular-nums">{num(p.daily_amount_krw, 0)}원</span>
                <span className="text-neutral-500">{p.start_date}~ {p.active ? '' : '(중지)'}{p.last_synced_date ? ` · ${p.last_synced_date}까지 반영` : ''}</span>
                {p.active && (
                  <ActionForm action={stopDcaAction} submit="중지">
                    <input type="hidden" name="ticker" value={p.ticker} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={dcaPlanAction} submit="계획 저장" className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <input name="ticker" placeholder="티커" required className={inputCls} />
            <input name="amount_krw" type="number" min="1" placeholder="일일 금액 (원)" required className={inputCls} />
            <input name="from_date" type="date" required className={inputCls} />
          </div>
        </ActionForm>
        <div className="mt-4 flex flex-wrap gap-6">
          <ActionForm action={syncDcaAction} submit="추정 매수 미리보기"><input type="hidden" name="apply" value="0" /></ActionForm>
          <ActionForm action={syncDcaAction} submit="추정 매수 기록하기"><input type="hidden" name="apply" value="1" /></ActionForm>
        </div>
        <p className="mt-2 text-xs text-neutral-500">실제 계좌의 체결가·환율과 다를 수 있는 추정치입니다 (종가 × 당일 USD/KRW).</p>
      </Card>

      <Card title="MCP 연결 (Claude 등)">
        <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
          엔드포인트: <code>{origin}/api/mcp</code>. Claude.ai 커넥터는 이 주소만 입력하면 OAuth로 연결됩니다. 그 외 클라이언트는 헤더 <code>Authorization: Bearer &lt;키&gt;</code>를 쓰세요.
        </p>
        <ul className="mb-4 space-y-1 text-sm">
          {(keys.data ?? []).map((k) => (
            <li key={k.id} className="flex items-center gap-3">
              <span className="font-medium">{k.name}</span>
              <code className="text-xs text-neutral-500">{k.key_prefix}…</code>
              {k.scope === 'analysis' && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800">분석 전용</span>}
              {k.scope === 'digest' && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800">알림 전달 전용</span>}
              <span className="text-xs text-neutral-500">
                {k.revoked_at ? '폐기됨' : k.last_used_at ? `마지막 사용 ${k.last_used_at.slice(0, 10)}` : '미사용'}
              </span>
              {!k.revoked_at && (
                <ActionForm action={revokeApiKeyAction} submit="폐기">
                  <input type="hidden" name="id" value={k.id} />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
        {apps.size > 0 && (
          <div className="mb-4">
            <div className="mb-1 text-xs font-semibold text-neutral-500">연결된 앱 (OAuth)</div>
            <ul className="space-y-1 text-sm">
              {[...apps.entries()].map(([clientId, a]) => (
                <li key={clientId} className="flex items-center gap-3">
                  <span className="font-medium">{a.name}</span>
                  <span className="text-xs text-neutral-500">{a.last ? `마지막 사용 ${a.last.slice(0, 10)}` : '미사용'}</span>
                  <ActionForm action={revokeOAuthClientAction} submit="해제">
                    <input type="hidden" name="client_id" value={clientId} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ActionForm action={createApiKeyAction} submit="새 키 만들기" className="space-y-2">
          <input name="name" placeholder="이름 (예: Claude Desktop)" required className={inputCls} />
          <select name="scope" className={inputCls} defaultValue="full">
            <option value="full">전체 권한 (Claude Desktop 등)</option>
            <option value="analysis">분석 전용 (자동 실행용: 거래·보유 수정 불가)</option>
            <option value="digest">알림 전달 전용 (요약·알림 읽기와 발송 확인만)</option>
          </select>
        </ActionForm>
      </Card>
    </>
  )
}

import type { ThesisClaim } from '@/lib/portfolio/service'
import type { ThesisHealth } from '@/lib/portfolio/calc'
import type { Database } from '@/lib/supabase/database.types'
import { ActionButton, ActionForm } from './ActionForm'
import { ClaimBadge, HealthBadge, inputCls } from './ui'
import {
  addClaimAction,
  deleteClaimAction,
  proposeClaimsAction,
  retireClaimAction,
  runThesisCheckAction,
  updateClaimAction,
} from '@/app/actions'

type Check = Database['public']['Tables']['thesis_checks']['Row']

export function ThesisClaims({
  ticker,
  claims,
  health,
  checks,
  hasThesis,
}: {
  ticker: string
  claims: ThesisClaim[]
  health: ThesisHealth
  checks: Check[]
  hasThesis: boolean
}) {
  const claimText = new Map(claims.map((c) => [c.id, c.claim]))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <HealthBadge level={health.level} stale={health.stale} />
        {health.total > 0 && (
          <span className="text-xs text-neutral-500">
            유효 {health.counts.intact} · 약화 {health.counts.weakened} · 붕괴 {health.counts.broken} · 미점검 {health.counts.unchecked}
          </span>
        )}
      </div>

      {claims.length ? (
        <ul className="space-y-3">
          {claims.map((c) => (
            <li key={c.id} className="text-sm">
              <div className="flex items-start gap-2">
                <ClaimBadge status={c.status} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{c.claim}</p>
                  {c.kill_criteria && <p className="mt-0.5 text-xs text-neutral-500">깨지는 조건: {c.kill_criteria}</p>}
                  {c.last_evidence && (
                    <p className="mt-1 whitespace-pre-wrap leading-relaxed text-neutral-700 dark:text-neutral-300">
                      <span className="tabular-nums text-xs text-neutral-500">{c.last_checked} </span>
                      {c.last_evidence}
                    </p>
                  )}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-neutral-500">수정 · 보관 · 삭제</summary>
                    <div className="mt-2 space-y-2">
                      <ActionForm action={updateClaimAction} submit="수정 (판정 초기화)" className="space-y-2">
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="ticker" value={ticker} />
                        <input name="claim" defaultValue={c.claim} required maxLength={500} className={inputCls} />
                        <input name="kill_criteria" defaultValue={c.kill_criteria ?? ''} maxLength={500} placeholder="깨지는 조건" className={inputCls} />
                      </ActionForm>
                      <div className="flex gap-4">
                        <ActionButton action={retireClaimAction} label="보관(점검 제외)" hidden={{ id: c.id, ticker }} />
                        <ActionForm action={deleteClaimAction} submit="삭제" confirm="이 주장과 점검 기록을 삭제할까요?">
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="ticker" value={ticker} />
                        </ActionForm>
                      </div>
                    </div>
                  </details>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-500">
          {hasThesis ? 'Thesis를 검증 가능한 주장으로 나누면 주기적으로 유효성을 점검할 수 있습니다.' : '먼저 위에 매수 Thesis를 적어 주세요.'}
        </p>
      )}

      <div className="flex flex-wrap gap-4">
        {!claims.length && hasThesis && <ActionButton action={proposeClaimsAction} label="Thesis에서 주장 추출 (AI)" hidden={{ ticker }} />}
        {claims.length > 0 && <ActionButton action={runThesisCheckAction} label="지금 점검 (AI)" hidden={{ ticker }} />}
      </div>

      <details>
        <summary className="cursor-pointer text-xs text-neutral-500">주장 직접 추가</summary>
        <ActionForm action={addClaimAction} submit="추가" className="mt-2 space-y-2">
          <input type="hidden" name="ticker" value={ticker} />
          <input name="claim" required maxLength={500} placeholder="검증 가능한 주장 (예: 데이터센터 매출이 분기마다 성장한다)" className={inputCls} />
          <input name="kill_criteria" maxLength={500} placeholder="이게 깨지는 조건 (예: 2분기 연속 역성장)" className={inputCls} />
        </ActionForm>
      </details>

      {checks.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-neutral-500">점검 기록 ({checks.length})</summary>
          <ul className="mt-2 space-y-2 text-sm">
            {checks.map((k) => (
              <li key={k.id}>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-xs text-neutral-500">{k.date}</span>
                  <ClaimBadge status={k.verdict} />
                  <span className="truncate text-xs text-neutral-500">{claimText.get(k.claim_id) ?? '(보관된 주장)'}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{k.evidence}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

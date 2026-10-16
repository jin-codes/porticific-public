import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import * as svc from '@/lib/portfolio/service'
import { num, pct, pnlClass, usd } from '@/lib/format'
import { Card, SignalBadge, Stat, inputCls } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { PriceChart } from '@/components/PriceChart'
import { ThesisClaims } from '@/components/ThesisClaims'
import { buyAction, sellAction, tagsAction, thesisAction } from '@/app/actions'

export const dynamic = 'force-dynamic'

export default async function StockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params
  const ticker = decodeURIComponent(raw).toUpperCase()
  const ctx = await requireCtx()
  const [s, history, checks] = await Promise.all([
    svc.getStock(ctx, ticker, 30),
    svc.priceHistory(ctx, ticker, 120),
    svc.listThesisChecks(ctx, { ticker, limit: 20 }),
  ])
  if (!s.holding && !s.watchlist && !s.recent_analysis.length) notFound()

  const price = s.latest_snapshot?.price ?? null
  const h = s.holding
  const cost = h ? h.quantity * h.avg_cost : null
  const pnl = h && price != null ? h.quantity * price - (cost as number) : null
  const thesis = h?.thesis ?? s.watchlist?.thesis ?? ''
  const tags = (h?.tags ?? s.watchlist?.tags ?? []).join(', ')
  const latest = s.recent_analysis[0]

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">{s.ticker}</h1>
        <SignalBadge signal={latest?.signal} />
        <span className="text-xs text-neutral-500">{h ? '보유' : s.watchlist ? '관심종목' : ''}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card><Stat label="현재가" value={usd(price)} sub={s.latest_snapshot ? `${pct(s.latest_snapshot.change_pct)} · ${s.latest_snapshot.date}` : undefined} tone={pnlClass(s.latest_snapshot?.change_pct)} /></Card>
        {h && <Card><Stat label="수량 / 평단" value={num(h.quantity, 4)} sub={usd(h.avg_cost)} /></Card>}
        {h && <Card><Stat label="평가손익" value={usd(pnl)} sub={cost ? pct((pnl! / cost) * 100) : undefined} tone={pnlClass(pnl)} /></Card>}
        {s.watchlist?.target_price != null && <Card><Stat label="목표가" value={usd(s.watchlist.target_price)} /></Card>}
      </div>

      <Card title="주가 (최근 120일 종가)">
        <PriceChart points={history} avgCost={h?.avg_cost} />
      </Card>

      {(h || s.watchlist) && (
        <Card title="매수 Thesis">
          <ActionForm action={thesisAction} submit="Thesis 저장" className="space-y-2">
            <input type="hidden" name="ticker" value={s.ticker} />
            <textarea name="thesis" defaultValue={thesis} rows={5} className={inputCls} />
          </ActionForm>
          <ActionForm action={tagsAction} submit="태그 저장" className="mt-4 space-y-2">
            <input type="hidden" name="ticker" value={s.ticker} />
            <label className="block text-xs text-neutral-500">태그 (쉼표로 구분)</label>
            <input name="tags" defaultValue={tags} className={inputCls} />
          </ActionForm>
        </Card>
      )}

      {(h || s.watchlist) && (
        <Card title="Thesis 검증">
          <ThesisClaims ticker={s.ticker} claims={s.thesis_claims} health={s.thesis_health} checks={checks} hasThesis={Boolean(thesis.trim())} />
        </Card>
      )}

      <Card title="분석 기록">
        {s.recent_analysis.length ? (
          <ul className="space-y-4">
            {s.recent_analysis.map((a) => (
              <li key={a.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-neutral-500">{a.date}</span>
                  <SignalBadge signal={a.signal} />
                  <span className="tabular-nums text-neutral-500">{usd(a.price)} ({pct(a.change_pct)})</span>
                </div>
                {a.reasoning && <p className="mt-1 whitespace-pre-wrap leading-relaxed text-neutral-700 dark:text-neutral-300">{a.reasoning}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">분석 기록이 없습니다.</p>
        )}
      </Card>

      {s.upcoming_events.length > 0 && (
        <Card title="다가오는 일정">
          <ul className="space-y-1 text-sm">
            {s.upcoming_events.map((e) => (
              <li key={`${e.event_date}${e.kind}`}><span className="tabular-nums text-neutral-500">{e.event_date}</span> {e.title ?? e.kind}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <Card title="매수 기록">
          <TradeForm action={buyAction} ticker={s.ticker} label="매수 기록" />
        </Card>
        {h && (
          <Card title="매도 기록">
            <TradeForm action={sellAction} ticker={s.ticker} label="매도 기록" />
          </Card>
        )}
      </div>

      {(s.buys.length > 0 || s.trades.length > 0) && (
        <Card title="거래 내역">
          <ul className="space-y-1 text-sm tabular-nums">
            {s.buys.map((b) => (
              <li key={b.id}>{b.buy_date} · 매수 {num(b.quantity, 4)} @ {usd(b.buy_price)} {b.source !== 'manual' && <span className="text-xs text-neutral-500">({b.source})</span>}</li>
            ))}
            {s.trades.map((t) => (
              <li key={t.id}>
                {t.sell_date} · 매도 {num(t.quantity, 4)} @ {usd(t.sell_price)} · <span className={pnlClass(t.realized_pnl)}>{usd(t.realized_pnl)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {s.dca_plan && (
        <Card title="DCA">
          <p className="text-sm">
            매일 {num(s.dca_plan.daily_amount_krw, 0)}원 · {s.dca_plan.start_date}부터 · {s.dca_plan.active ? '진행 중' : '중지'}
            {s.dca_plan.last_synced_date && ` · ${s.dca_plan.last_synced_date}까지 반영`}
          </p>
        </Card>
      )}
    </>
  )
}

function TradeForm({ action, ticker, label }: { action: typeof buyAction; ticker: string; label: string }) {
  return (
    <ActionForm action={action} submit={label} className="space-y-2">
      <input type="hidden" name="ticker" value={ticker} />
      <div className="grid grid-cols-2 gap-2">
        <input name="quantity" type="number" step="any" min="0" placeholder="수량" required className={inputCls} />
        <input name="price" type="number" step="any" min="0" placeholder="가격 (USD)" required className={inputCls} />
        <input name="date" type="date" className={inputCls} />
        <input name="note" placeholder="메모" className={inputCls} />
      </div>
      <label className="flex items-center gap-2 text-xs text-neutral-500">
        <input type="checkbox" name="no_cash" /> 현금에 반영하지 않기
      </label>
    </ActionForm>
  )
}

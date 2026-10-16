import Link from 'next/link'
import { requireCtx } from '@/lib/auth'
import * as svc from '@/lib/portfolio/service'
import { num, pct, pnlClass, usd } from '@/lib/format'
import { Card, HealthBadge, SignalBadge, Stat, Tags, TickerLink } from '@/components/ui'
import { ActionButton } from '@/components/ActionForm'
import { AllocationBar } from '@/components/AllocationBar'
import { refreshPricesAction } from '@/app/actions'

export const dynamic = 'force-dynamic'

export default async function Dashboard() {
  const ctx = await requireCtx()
  const [summary, holdings, analysis, events] = await Promise.all([
    svc.portfolioSummary(ctx),
    svc.listHoldings(ctx),
    svc.listPortfolioAnalysis(ctx, 1),
    svc.upcomingEvents(ctx, 14),
  ])
  const tickers = holdings.map((h) => h.ticker)
  // Prices are already resolved in `summary`; the date line only needs the signal map and snapshot dates.
  const [signals, snaps, health] = await Promise.all([
    svc.latestAnalysisMap(ctx, tickers),
    svc.latestSnapshots(ctx, tickers),
    svc.thesisHealthMap(ctx, tickers),
  ])
  const tagsOf = Object.fromEntries(holdings.map((h) => [h.ticker, h.tags]))
  const latest = analysis[0]
  const priceDate = Object.values(snaps).map((s) => s.date).sort().pop()
  const mine = new Set(tickers)

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card><Stat label="평가금액" value={usd(summary.total_market_value)} sub={`원가 ${usd(summary.total_cost_basis)}`} /></Card>
        <Card>
          <Stat label="평가손익" value={usd(summary.total_unrealized_pnl)} sub={pct(summary.total_unrealized_pnl_pct)} tone={pnlClass(summary.total_unrealized_pnl)} />
        </Card>
        <Card><Stat label="실현손익" value={usd(summary.total_realized_pnl)} tone={pnlClass(summary.total_realized_pnl)} /></Card>
        {summary.cash != null ? (
          <Card>
            <Stat label="현금" value={usd(summary.cash)} sub={`총자산의 ${summary.cash_pct ?? 0}% · ${summary.holdings.length}종목`} />
          </Card>
        ) : (
          <Card>
            <Stat label="보유 종목" value={String(summary.holdings.length)} sub={priceDate ? `시세 ${priceDate}` : '시세 없음'} />
            <Link href="/trades" className="mt-1 block text-xs text-neutral-500 underline-offset-2 hover:underline">현금 기록 시작하기</Link>
          </Card>
        )}
      </div>

      {latest && (
        <Card title={`오늘의 포트폴리오 분석 · ${latest.date}`}>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{latest.summary}</p>
          {latest.top_pick && (
            <p className="mt-3 text-sm">
              <span className="font-semibold">관심종목 Top pick: </span>
              <TickerLink ticker={latest.top_pick} />
              {latest.top_pick_reason && <span className="text-neutral-500"> — {latest.top_pick_reason}</span>}
            </p>
          )}
        </Card>
      )}

      {summary.holdings.length > 0 && (
        <Card title={summary.cash != null ? '비중 (현금 포함)' : '비중'}>
          <AllocationBar
            slices={summary.holdings.map((r) => ({
              ticker: r.ticker,
              // allocation_pct is the share of invested money; with cash tracked it shrinks by the cash share
              pct: Math.round((r.allocation_pct ?? 0) * (summary.cash_pct != null ? (100 - summary.cash_pct) / 100 : 1) * 100) / 100,
            })).sort((a, b) => b.pct - a.pct)}
            cashPct={summary.cash_pct}
          />
        </Card>
      )}

      <Card title="보유 종목">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="text-left text-xs text-neutral-500">
              <tr>
                <th className="py-1.5 pr-3">종목</th>
                <th className="pr-3 text-right">수량</th>
                <th className="pr-3 text-right">평단</th>
                <th className="pr-3 text-right">현재가</th>
                <th className="pr-3 text-right">손익</th>
                <th className="pr-3 text-right">비중</th>
                <th className="pr-3">신호</th>
                <th>Thesis</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {summary.holdings.map((r) => (
                <tr key={r.ticker} className="border-t border-neutral-100 dark:border-neutral-900">
                  <td className="py-2 pr-3">
                    <TickerLink ticker={r.ticker} />
                    <div className="mt-0.5"><Tags tags={tagsOf[r.ticker] ?? []} /></div>
                  </td>
                  <td className="pr-3 text-right">{num(r.quantity, 4)}</td>
                  <td className="pr-3 text-right">{usd(r.avg_cost)}</td>
                  <td className="pr-3 text-right">{usd(r.price)}</td>
                  <td className={`pr-3 text-right ${pnlClass(r.unrealized_pnl)}`}>
                    {pct(r.unrealized_pnl_pct)}
                    <div className="text-xs">{usd(r.unrealized_pnl)}</div>
                  </td>
                  <td className="pr-3 text-right">{r.allocation_pct == null ? '–' : `${r.allocation_pct}%`}</td>
                  <td className="pr-3"><SignalBadge signal={signals[r.ticker]?.signal} /></td>
                  <td><HealthBadge level={health[r.ticker]?.level} stale={health[r.ticker]?.stale} /></td>
                </tr>
              ))}
              {!summary.holdings.length && (
                <tr><td colSpan={8} className="py-6 text-center text-neutral-500">보유 종목이 없습니다. 거래 탭에서 매수를 기록하세요.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-neutral-500">표의 비중은 투자금 기준입니다{summary.cash == null ? ' (현금은 기록하지 않음).' : ' (현금 제외).'}</p>
        <div className="mt-3"><ActionButton action={refreshPricesAction} label="시세 새로고침" /></div>
      </Card>

      <Card title="다가오는 일정 (14일)">
        {events.length ? (
          <ul className="space-y-1 text-sm">
            {events.map((e) => (
              <li key={`${e.ticker}${e.event_date}${e.kind}`} className="flex gap-3">
                <span className="w-24 tabular-nums text-neutral-500">{e.event_date}</span>
                <span className={mine.has(e.ticker) ? 'font-medium' : ''}>{e.title ?? `${e.ticker} ${e.kind}`}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">예정된 일정이 없습니다.</p>
        )}
      </Card>
    </>
  )
}

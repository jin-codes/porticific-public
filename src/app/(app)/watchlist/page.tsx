import { requireCtx } from '@/lib/auth'
import * as svc from '@/lib/portfolio/service'
import { pct, pnlClass, usd } from '@/lib/format'
import { Card, SignalBadge, Tags, TickerLink, inputCls } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { removeWatchlistAction, watchlistAction } from '@/app/actions'

export const dynamic = 'force-dynamic'

export default async function WatchlistPage() {
  const ctx = await requireCtx()
  const watchlist = await svc.listWatchlist(ctx)
  const tickers = watchlist.map((w) => w.ticker)
  const [signals, snaps] = await Promise.all([svc.latestAnalysisMap(ctx, tickers), svc.latestSnapshots(ctx, tickers)])

  const rows = watchlist.map((w) => {
    const price = snaps[w.ticker]?.price ?? null
    return {
      ...w,
      price,
      change: snaps[w.ticker]?.change_pct ?? null,
      gap: price != null && w.target_price ? ((price - w.target_price) / w.target_price) * 100 : null,
      signal: signals[w.ticker]?.signal,
    }
  })
  // Buy-ready first, then by signal presence
  const order = ['buy', 'buy_wait', 'drop_watch']
  rows.sort((a, b) => (order.indexOf(a.signal ?? '') + 1 || 99) - (order.indexOf(b.signal ?? '') + 1 || 99) || a.ticker.localeCompare(b.ticker))

  return (
    <>
      <h1 className="text-xl font-semibold">관심종목</h1>
      <Card title="추가 / 수정">
        <ActionForm action={watchlistAction} submit="저장" className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <input name="ticker" placeholder="티커" required className={inputCls} />
            <input name="target_price" type="number" step="any" min="0" placeholder="목표가 (USD)" className={inputCls} />
            <input name="thesis" placeholder="Thesis (선택)" className={inputCls} />
          </div>
        </ActionForm>
      </Card>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-neutral-500">
              <tr>
                <th className="py-1.5 pr-3">종목</th>
                <th className="pr-3 text-right">현재가</th>
                <th className="pr-3 text-right">등락</th>
                <th className="pr-3 text-right">목표가</th>
                <th className="pr-3 text-right">목표 대비</th>
                <th className="pr-3">신호</th>
                <th />
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r) => (
                <tr key={r.ticker} className="border-t border-neutral-100 dark:border-neutral-900">
                  <td className="py-2 pr-3">
                    <TickerLink ticker={r.ticker} />
                    <div className="mt-0.5"><Tags tags={r.tags} /></div>
                  </td>
                  <td className="pr-3 text-right">{usd(r.price)}</td>
                  <td className={`pr-3 text-right ${pnlClass(r.change)}`}>{pct(r.change)}</td>
                  <td className="pr-3 text-right">{usd(r.target_price)}</td>
                  <td className="pr-3 text-right">{pct(r.gap)}</td>
                  <td className="pr-3"><SignalBadge signal={r.signal} /></td>
                  <td className="text-right">
                    <ActionForm action={removeWatchlistAction} submit="삭제">
                      <input type="hidden" name="ticker" value={r.ticker} />
                    </ActionForm>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="py-6 text-center text-neutral-500">관심종목이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

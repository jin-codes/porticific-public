import { requireCtx } from '@/lib/auth'
import * as svc from '@/lib/portfolio/service'
import { num, pnlClass, usd } from '@/lib/format'
import { Card, TickerLink, inputCls } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { buyAction, cashEventAction, deleteCashEventAction, sellAction, setCashBalanceAction } from '@/app/actions'

export const dynamic = 'force-dynamic'

function TradeForm({ action, label }: { action: typeof buyAction; label: string }) {
  return (
    <ActionForm action={action} submit={label} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input name="ticker" placeholder="티커" required className={inputCls} />
        <input name="quantity" type="number" step="any" min="0" placeholder="수량" required className={inputCls} />
        <input name="price" type="number" step="any" min="0" placeholder="가격 (USD)" required className={inputCls} />
        <input name="date" type="date" className={inputCls} />
        <input name="note" placeholder="메모" className={`${inputCls} col-span-2`} />
      </div>
      <label className="flex items-center gap-2 text-xs text-neutral-500">
        <input type="checkbox" name="no_cash" /> 현금에 반영하지 않기
      </label>
    </ActionForm>
  )
}

const CASH_KIND: Record<string, string> = {
  deposit: '입금',
  withdrawal: '출금',
  dividend: '배당·이자',
  adjustment: '잔고 조정',
  buy: '매수',
  sell: '매도',
}

export default async function TradesPage() {
  const ctx = await requireCtx()
  const [buys, trades, cash, cashEvents] = await Promise.all([
    svc.listBuys(ctx, { limit: 50 }),
    svc.listTrades(ctx, { limit: 50 }),
    svc.cashBalance(ctx),
    svc.listCashEvents(ctx, 15),
  ])
  const events = [
    ...buys.map((b) => ({ id: b.id, date: b.buy_date, ticker: b.ticker, side: '매수', qty: b.quantity, price: b.buy_price, pnl: null as number | null, note: b.note, src: b.source })),
    ...trades.map((t) => ({ id: t.id, date: t.sell_date, ticker: t.ticker, side: '매도', qty: t.quantity, price: t.sell_price, pnl: t.realized_pnl, note: t.note, src: 'manual' })),
  ].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <>
      <h1 className="text-xl font-semibold">거래</h1>
      <div className="grid gap-6 sm:grid-cols-2">
        <Card title="매수 기록 (평단 자동 계산)"><TradeForm action={buyAction} label="매수 기록" /></Card>
        <Card title="매도 기록 (실현손익 자동 계산)"><TradeForm action={sellAction} label="매도 기록" /></Card>
      </div>
      <Card title={cash == null ? '현금 (기록 전)' : `현금 · ${usd(cash)}`}>
        {cash == null && (
          <p className="mb-3 text-sm text-neutral-500">
            현재 현금 잔고를 한 번 설정하면, 그 날짜 이후의 매수·매도가 현금을 자동으로 늘리고 줄입니다. 달러(USD) 기준입니다.
          </p>
        )}
        <div className="grid gap-6 sm:grid-cols-2">
          <ActionForm action={setCashBalanceAction} submit={cash == null ? '잔고 설정으로 시작' : '잔고 맞추기'} className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input name="balance" type="number" step="any" min="0" placeholder="현재 현금 잔고 (USD)" required className={inputCls} />
              <input name="date" type="date" className={inputCls} />
            </div>
          </ActionForm>
          <ActionForm action={cashEventAction} submit="입출금·배당 기록" className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select name="kind" className={inputCls} defaultValue="deposit">
                <option value="deposit">입금</option>
                <option value="withdrawal">출금</option>
                <option value="dividend">배당·이자</option>
              </select>
              <input name="amount" type="number" step="any" min="0" placeholder="금액 (USD)" required className={inputCls} />
              <input name="date" type="date" className={inputCls} />
              <input name="note" placeholder="메모" className={inputCls} />
            </div>
          </ActionForm>
        </div>
        {cashEvents.length > 0 && (
          <table className="mt-4 w-full text-sm tabular-nums">
            <tbody>
              {cashEvents.map((e) => (
                <tr key={e.id} className="border-t border-neutral-100 dark:border-neutral-900">
                  <td className="py-1.5 pr-3 text-neutral-500">{e.date}</td>
                  <td className="pr-3">{CASH_KIND[e.kind] ?? e.kind}{e.ticker ? ` ${e.ticker}` : ''}</td>
                  <td className={`pr-3 text-right ${pnlClass(e.amount)}`}>{usd(e.amount)}</td>
                  <td className="pr-3 text-neutral-500">{e.note ?? ''}</td>
                  <td className="text-right">
                    {e.kind !== 'buy' && e.kind !== 'sell' && (
                      <ActionForm action={deleteCashEventAction} submit="삭제" confirm="이 현금 내역을 삭제할까요? 잔고가 바뀝니다.">
                        <input type="hidden" name="id" value={e.id} />
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="최근 거래">
        <table className="w-full text-sm tabular-nums">
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-neutral-100 dark:border-neutral-900">
                <td className="py-2 pr-3 text-neutral-500">{e.date}</td>
                <td className="pr-3"><TickerLink ticker={e.ticker} /></td>
                <td className="pr-3">{e.side}{e.src !== 'manual' && <span className="ml-1 text-xs text-neutral-500">({e.src})</span>}</td>
                <td className="pr-3 text-right">{num(e.qty, 4)}</td>
                <td className="pr-3 text-right">{usd(e.price)}</td>
                <td className={`text-right ${pnlClass(e.pnl)}`}>{e.pnl == null ? '' : usd(e.pnl)}</td>
              </tr>
            ))}
            {!events.length && <tr><td className="py-6 text-center text-neutral-500">거래 기록이 없습니다.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  )
}

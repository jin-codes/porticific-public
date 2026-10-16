import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import * as svc from '@/lib/portfolio/service'
import type { Ctx } from '@/lib/portfolio/service'
import type { Signal } from '@/lib/portfolio/calc'

// Port of the DAILY_ANALYSIS.md workflow from the single-user prototype: per-ticker
// signal + reasoning against the buy thesis and yesterday's analysis, then a
// portfolio summary and a watchlist top pick.

const SIGNAL_GUIDE = `Signals (use the exact literal):
- add_more: thesis reinforced, grounds to add (holdings)
- hold: thesis still holds, nothing notable (holdings)
- watch: thesis mostly holds but an early warning sign exists; not sell-worthy yet (holdings)
- trim: partial profit-taking / risk reduction, not a full exit (holdings)
- sell: thesis broken, grounds to exit (holdings)
- urgent_sell: serious bad news warranting immediate exit; do not overuse (holdings)
- avoid_chasing: position ran up sharply short-term; don't add now (holdings)
- buy: grounds for a new entry (watchlist)
- buy_wait: thesis holds but now is not the entry point (watchlist)
- drop_watch: thesis never held or fell apart (watchlist)`

const PRINCIPLES = `You write the user's own daily portfolio notes. This is a personal record, not investment advice.
- Treat yesterday's analysis as the baseline. Ask what materially changed since then. With no new fact that shakes the thesis, keep the prior signal and say "same as prior day — because ...". When you change a signal, state what changed.
- Every company has good and bad points at once. Weigh the opposing side, especially for strong signals (add_more, sell, urgent_sell).
- If cash is given (cash.pct_of_total_assets), factor the cash share into the portfolio summary and the wording of add/trim signals; if it is null, cash is not tracked, so say nothing about it.
- thesis_claims (when present) are the falsifiable pillars of the buy thesis with their latest verdict. A weakened or broken claim must be addressed in the reasoning and should pull the signal toward watch / trim / sell unless you can explain why not; do not re-judge claims here, the dedicated thesis check does that.
- Upcoming earnings / ex-dividend / FOMC dates should shape the signal (a run-up into earnings argues against add_more).
- If an investment profile is given, carry its risk tolerance, horizon and concentration stance into the judgement and the tone. Write prose in the language the profile specifies; default to the language of the buy thesis, else English.
- Be specific: 5-8 sentences citing concrete facts and how they hold up or break the thesis.
${SIGNAL_GUIDE}`

export interface DailyAnalysisResult {
  status: 'ok' | 'skipped'
  reason?: string
  date?: string
  analyzed?: { ticker: string; signal: string }[]
  failed?: { ticker: string; error: string }[]
  top_pick?: string | null
}

export function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

function toolInput<T>(res: Anthropic.Messages.Message, name: string): T | null {
  const block = res.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use' && b.name === name)
  return (block?.input as T) ?? null
}

export async function callWithTool<T>(
  anthropic: Anthropic,
  opts: { model: string; system: string; user: string; tool: Anthropic.Messages.Tool; webSearch: boolean; maxTokens?: number }
): Promise<T> {
  const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: opts.user }]
  // With web search the model must be free to search first, so the tool can't be forced.
  const tools: Anthropic.Messages.ToolUnion[] = opts.webSearch
    ? [{ type: 'web_search_20260318', name: 'web_search', max_uses: 4 } as Anthropic.Messages.ToolUnion, opts.tool]
    : [opts.tool]

  for (let turn = 0; turn < 6; turn++) {
    const res = await anthropic.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.system,
      messages,
      tools,
      tool_choice: opts.webSearch ? { type: 'auto' } : { type: 'tool', name: opts.tool.name },
    })
    const out = toolInput<T>(res, opts.tool.name)
    if (out) return out
    if (res.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: res.content })
      continue
    }
    messages.push({ role: 'assistant', content: res.content })
    messages.push({ role: 'user', content: `Now call ${opts.tool.name} with your conclusion.` })
  }
  throw new Error(`model never called ${opts.tool.name}`)
}

export async function runDailyAnalysis(ctx: Ctx): Promise<DailyAnalysisResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { status: 'skipped', reason: 'ANTHROPIC_API_KEY is not set on the server' }
  }
  const model = process.env.ANALYSIS_MODEL ?? 'claude-sonnet-5-5'
  const webSearch = process.env.ANALYSIS_WEB_SEARCH === '1'
  const maxTickers = Number(process.env.ANALYSIS_MAX_TICKERS ?? 30)
  const anthropic = client()

  const context = await svc.analysisContext(ctx, { maxTickers })
  const { date, investment_profile: profile } = context
  const items = context.items
  if (!items.length) return { status: 'skipped', reason: 'no holdings or watchlist' }

  const analyzed: { ticker: string; kind: string; signal: Signal; reasoning: string; price: number | null }[] = []
  const failed: { ticker: string; error: string }[] = []

  for (const item of items) {
    if (item.price == null) {
      failed.push({ ticker: item.ticker, error: 'no price data' })
      continue
    }
    try {
      const signals = item.allowed_signals
      const out = await callWithTool<{ signal: Signal; reasoning: string }>(anthropic, {
        model,
        system: PRINCIPLES + (profile ? `\n\nInvestment profile:\n${profile}` : '\n\n(No investment profile set: judge on neutral criteria.)'),
        user: JSON.stringify({
          today: date,
          ticker: item.ticker,
          kind: item.kind,
          thesis: item.thesis,
          position: item.position,
          price: item.price,
          change_pct: item.change_pct,
          previous_analysis: item.previous_analysis,
          upcoming_events: item.upcoming_events,
        }),
        webSearch,
        tool: {
          name: 'submit_analysis',
          description: `Submit today's analysis for ${item.ticker}.`,
          input_schema: {
            type: 'object',
            properties: {
              signal: { type: 'string', enum: [...signals] },
              reasoning: { type: 'string' },
            },
            required: ['signal', 'reasoning'],
          },
        },
      })
      if (!(signals as readonly string[]).includes(out.signal)) throw new Error(`invalid signal ${out.signal}`)
      await svc.saveAnalysis(ctx, { ticker: item.ticker, date, price: item.price, change_pct: item.change_pct, signal: out.signal, reasoning: out.reasoning })
      analyzed.push({ ticker: item.ticker, kind: item.kind, signal: out.signal, reasoning: out.reasoning, price: item.price })
    } catch (e) {
      failed.push({ ticker: item.ticker, error: e instanceof Error ? e.message : String(e) })
    }
  }

  let topPick: string | null = null
  if (analyzed.length) {
    try {
      const buys = analyzed.filter((a) => a.kind === 'watchlist' && a.signal === 'buy').map((a) => a.ticker)
      const prevSummary = context.previous_portfolio_analysis
      const out = await callWithTool<{ summary: string; top_pick?: string; top_pick_reason?: string }>(anthropic, {
        model,
        system: PRINCIPLES + (profile ? `\n\nInvestment profile:\n${profile}` : ''),
        user: JSON.stringify({
          today: date,
          cash: context.cash,
          results: analyzed.map(({ ticker, kind, signal, price }) => ({ ticker, kind, signal, price, change_pct: items.find((i) => i.ticker === ticker)?.change_pct ?? null })),
          watchlist_buy_candidates: buys,
          previous_top_pick: prevSummary ? { top_pick: prevSummary.top_pick, reason: prevSummary.top_pick_reason } : null,
          instructions:
            'Write a 2-4 sentence portfolio summary: tone of the day, whether any fundamental damage shows in the profile\'s concentrated themes (say "no notable warnings" if none), and what the signal distribution suggests. If there are buy candidates, choose ONE top pick (keep the previous pick if still strongest) with a 1-2 sentence reason; otherwise omit the top pick.',
        }),
        webSearch: false,
        tool: {
          name: 'submit_portfolio_summary',
          description: 'Submit the portfolio-level summary and optional watchlist top pick.',
          input_schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              top_pick: { type: 'string', enum: buys.length ? buys : undefined },
              top_pick_reason: { type: 'string' },
            },
            required: ['summary'],
          },
        },
      })
      topPick = out.top_pick && buys.includes(out.top_pick) ? out.top_pick : null
      await svc.savePortfolioAnalysis(ctx, {
        date,
        summary: out.summary,
        top_pick: topPick,
        top_pick_reason: topPick ? (out.top_pick_reason ?? null) : null,
      })
    } catch (e) {
      failed.push({ ticker: '(portfolio)', error: e instanceof Error ? e.message : String(e) })
    }
  }

  return { status: 'ok', date, analyzed: analyzed.map(({ ticker, signal }) => ({ ticker, signal })), failed, top_pick: topPick }
}

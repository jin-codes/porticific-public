import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z, type ZodRawShape } from 'zod'
import * as svc from '@/lib/portfolio/service'
import { makeCtx } from '@/lib/portfolio/service'
import { runDailyAnalysis } from '@/lib/analysis/daily'
import { proposeClaims, runThesisCheck } from '@/lib/analysis/thesis'
import { sendAlerts } from '@/lib/notify/run'
import { ALERT_KINDS } from '@/lib/notify/digest'
import { SIGNALS, VERDICTS } from '@/lib/portfolio/calc'
import { toolAllowed } from './scope'
import { toolTitle } from './title'

const READ: ToolAnnotations = { readOnlyHint: true }
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false }
const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true }


const ticker = z.string().min(1).max(15).describe('Ticker symbol, e.g. AAPL')
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')

interface ToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

function register<S extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  annotations: ToolAnnotations,
  shape: S,
  run: (ctx: svc.Ctx, args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<unknown>
) {
  // The SDK's generic callback typing can't follow a generic shape; validation is done by zod at runtime.
  const registerTool = server.registerTool.bind(server) as unknown as (
    name: string,
    config: { title: string; description: string; annotations: ToolAnnotations; inputSchema: ZodRawShape },
    cb: (args: unknown, extra: { authInfo?: { extra?: Record<string, unknown> } }) => Promise<ToolResult>
  ) => void

  registerTool(name, { title: toolTitle(name), description, annotations, inputSchema: shape }, async (args, extra) => {
    const userId = extra.authInfo?.extra?.userId as string | undefined
    if (!userId) return { content: [{ type: 'text', text: 'Unauthorized: missing API key context.' }], isError: true }
    if (!toolAllowed(extra.authInfo?.extra?.scope, name)) {
      return { content: [{ type: 'text', text: `Error: this API key's scope does not allow ${name}.` }], isError: true }
    }
    try {
      const result = await run(makeCtx(userId), args as z.objectOutputType<S, z.ZodTypeAny>)
      return { content: [{ type: 'text', text: JSON.stringify(result ?? null, null, 2) }] }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error'
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
    }
  })
}

export function configureMcpServer(server: McpServer) {
  // ------------------------------------------------------------------ reads
  register(server, 'portfolio_summary',
    'Holdings with cost basis, price, unrealized P&L and allocation (share of invested money; cash is not tracked), plus realized P&L total. live=true uses current prices.',
    READ, { live: z.boolean().default(false) },
    (ctx, a) => svc.portfolioSummary(ctx, { live: a.live }))

  register(server, 'list_holdings', 'Raw holdings rows incl. buy thesis and tags.', READ, {},
    (ctx) => svc.listHoldings(ctx))

  register(server, 'list_watchlist', 'Watchlist rows: target price, thesis, tags.', READ, {},
    (ctx) => svc.listWatchlist(ctx))

  register(server, 'get_stock',
    'Everything about one ticker: holding / watchlist entry with buy thesis, latest price, recent analysis, buys, sells, DCA plan, upcoming events.',
    READ, { ticker, analysis_days: z.number().int().min(1).max(30).default(5) },
    (ctx, a) => svc.getStock(ctx, a.ticker, a.analysis_days))

  register(server, 'get_prices',
    'Current price per ticker. live=true fetches now from the price provider (not stored); live=false returns the last stored snapshot.',
    READ, { tickers: z.array(ticker).min(1).max(30), live: z.boolean().default(true) },
    (ctx, a) => svc.getPrices(ctx, a.tickers, a.live))

  register(server, 'get_analysis', 'Daily analysis rows (signal + reasoning), newest first.', READ,
    { ticker: ticker.optional(), date: isoDate.optional(), limit: z.number().int().min(1).max(100).default(20) },
    (ctx, a) => svc.listAnalysis(ctx, a))

  register(server, 'get_portfolio_analysis', 'Overall daily portfolio summary text and watchlist top pick, newest first.', READ,
    { limit: z.number().int().min(1).max(30).default(1) },
    (ctx, a) => svc.listPortfolioAnalysis(ctx, a.limit))

  register(server, 'report',
    "Grouped report: 'signals' (by latest analysis signal), 'tags' (by theme tag) or 'watchlist' (price vs target).",
    READ, { kind: z.enum(['signals', 'tags', 'watchlist']).default('signals') },
    (ctx, a) => svc.report(ctx, a.kind))

  register(server, 'upcoming_events', 'Earnings / ex-dividend / FOMC events in the next N days.', READ,
    { days: z.number().int().min(1).max(120).default(14) },
    (ctx, a) => svc.upcomingEvents(ctx, a.days))

  register(server, 'list_trades', 'Sell history with realized P&L, newest first.', READ,
    { ticker: ticker.optional(), limit: z.number().int().min(1).max(200).default(20) },
    (ctx, a) => svc.listTrades(ctx, a))

  register(server, 'get_cash',
    'Cash balance (USD) and recent cash events. balance is null when cash tracking has not been started (no cash events yet).',
    READ, { limit: z.number().int().min(1).max(100).default(20) },
    (ctx, a) => svc.getCash(ctx, a.limit))

  register(server, 'list_thesis_claims',
    "A ticker's (or every ticker's) falsifiable thesis claims with current status (unchecked / intact / weakened / broken), last evidence and kill criteria, plus rolled-up health per ticker.",
    READ, { ticker: ticker.optional(), include_inactive: z.boolean().default(false) },
    async (ctx, a) => {
      const claims = await svc.listClaims(ctx, { ticker: a.ticker, includeInactive: a.include_inactive })
      return { claims, health: await svc.thesisHealthMap(ctx, a.ticker ? [a.ticker.toUpperCase()] : undefined) }
    })

  register(server, 'get_thesis_checks', 'History of thesis check verdicts with evidence, newest first.', READ,
    { ticker: ticker.optional(), claim_id: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).default(30) },
    (ctx, a) => svc.listThesisChecks(ctx, { ticker: a.ticker, claimId: a.claim_id, limit: a.limit }))

  register(server, 'list_dca_plans', 'Recurring daily KRW purchase plans.', READ, {},
    (ctx) => svc.listDcaPlans(ctx))

  register(server, 'get_investment_profile', "The user's saved investment profile text (risk tolerance, horizon, concentration rules).", READ, {},
    async (ctx) => ({ profile: await svc.getProfile(ctx) }))

  // ----------------------------------------------------------------- writes
  register(server, 'set_thesis', 'Set the buy thesis text for a ticker (holdings and/or watchlist row).', WRITE,
    { ticker, thesis: z.string().max(20000) },
    (ctx, a) => svc.setThesis(ctx, a.ticker, a.thesis))

  register(server, 'record_buy',
    'Record a purchase: writes a buys row and folds it into holdings (weighted-average cost); creates the holding if new. If cash tracking is on, cash is reduced too (affect_cash=false to skip).', WRITE,
    {
      ticker,
      quantity: z.number().positive(),
      price: z.number().min(0),
      date: isoDate.optional(),
      note: z.string().max(500).optional(),
      affect_cash: z.boolean().default(true),
    },
    (ctx, a) => svc.recordBuy(ctx, a))

  register(server, 'record_sell',
    'Record a sale: writes a trades row with realized P&L and reduces (or removes) the holding. If cash tracking is on, cash is increased too (affect_cash=false to skip).', DESTRUCTIVE,
    {
      ticker,
      quantity: z.number().positive(),
      price: z.number().min(0),
      date: isoDate.optional(),
      note: z.string().max(500).optional(),
      affect_cash: z.boolean().default(true),
    },
    (ctx, a) => svc.recordSell(ctx, a))

  register(server, 'record_cash_event',
    'Record a cash movement in USD: deposit, withdrawal or dividend (amount is always positive). Starts cash tracking if it was off.', WRITE,
    {
      kind: z.enum(['deposit', 'withdrawal', 'dividend']),
      amount: z.number().positive(),
      date: isoDate.optional(),
      note: z.string().max(500).optional(),
    },
    (ctx, a) => svc.recordCashEvent(ctx, a))

  register(server, 'set_cash_balance',
    'Set the cash balance (USD) to an exact figure; the difference is recorded as an adjustment. This starts cash tracking: later trades dated on/after the first cash event move cash automatically.', WRITE,
    { balance: z.number().min(0), date: isoDate.optional(), note: z.string().max(500).optional() },
    (ctx, a) => svc.setCashBalance(ctx, a.balance, a))

  register(server, 'delete_cash_event',
    'Delete a manually entered cash event (deposit, withdrawal, dividend, adjustment) by id from get_cash. Buy/sell cash rows follow the ledger and cannot be deleted. Deleting the last manual event turns cash tracking off (balance becomes null).', DESTRUCTIVE,
    { id: z.string().uuid() },
    (ctx, a) => svc.deleteCashEvent(ctx, a.id))

  register(server, 'correct_holding',
    'Overwrite holding fields directly WITHOUT a ledger row. Only for fixing wrong data; use record_buy / record_sell for real transactions.', DESTRUCTIVE,
    { ticker, quantity: z.number().min(0).optional(), avg_cost: z.number().min(0).optional(), first_buy_date: isoDate.optional() },
    (ctx, a) => svc.correctHolding(ctx, a.ticker, a))

  register(server, 'add_thesis_claims',
    'Add falsifiable claims to a ticker\'s thesis (max 12 active per ticker). Each claim is one checkable statement; kill_criteria is the observation that would prove it wrong. New claims start unchecked.', WRITE,
    { ticker, claims: z.array(z.object({ claim: z.string().min(1).max(500), kill_criteria: z.string().max(500).optional() })).min(1).max(12) },
    (ctx, a) => svc.addClaims(ctx, a.ticker, a.claims))

  register(server, 'update_thesis_claim',
    'Edit a claim\'s wording / kill criteria (resets it to unchecked) or retire/restore it with active. Retired claims are kept but ignored.', WRITE,
    { id: z.string().uuid(), claim: z.string().min(1).max(500).optional(), kill_criteria: z.string().max(500).nullable().optional(), active: z.boolean().optional() },
    (ctx, a) => svc.updateClaim(ctx, a.id, a))

  register(server, 'delete_thesis_claim', 'Permanently delete a claim and its check history. Prefer update_thesis_claim active=false to keep history.', DESTRUCTIVE,
    { id: z.string().uuid() },
    (ctx, a) => svc.deleteClaim(ctx, a.id))

  register(server, 'thesis_review_context',
    'Per ticker: the thesis, position, latest stored price, upcoming events and each claim with kill criteria, status and recent checks. Read-only input for re-checking claims.',
    READ, { ticker: ticker.optional() },
    (ctx, a) => svc.thesisReviewContext(ctx, { ticker: a.ticker }))

  register(server, 'save_thesis_check',
    'Record a verdict for one claim (intact / weakened / broken) with 2-4 sentences of concrete evidence. Replaces an earlier check for the same claim and date; updates the claim status.', WRITE,
    { claim_id: z.string().uuid(), verdict: z.enum(VERDICTS), evidence: z.string().min(1).max(4000), date: isoDate.optional() },
    (ctx, a) => svc.saveThesisCheck(ctx, a))

  register(server, 'propose_thesis_claims',
    "Split a ticker's thesis text into 3-6 falsifiable claims with kill criteria and store them. Runs on the user's own Anthropic API key saved in Settings; returns status 'skipped' with the reason when no key is available or the ticker already has claims.", WRITE,
    { ticker },
    (ctx, a) => proposeClaims(ctx, a.ticker))

  register(server, 'run_thesis_check',
    "Re-check the active claims of one ticker (or all tickers, up to the server's per-run cap) against current facts and store the verdicts. Runs on the user's own Anthropic API key saved in Settings; returns status 'skipped' with the reason when no key is available.", WRITE,
    { ticker: ticker.optional() },
    (ctx, a) => runThesisCheck(ctx, { ticker: a.ticker }))

  register(server, 'get_notification_settings', 'Email alert settings: enabled, override address (null = login email) and which alert kinds are sent.', READ, {},
    (ctx) => svc.getNotificationPrefs(ctx))

  register(server, 'set_notification_settings',
    'Turn email alerts on/off, set the receiving address (empty string = login email) and/or the alert kinds (thesis, signal, event, target). Omitted fields stay as they are.', WRITE,
    { email_enabled: z.boolean().optional(), email: z.union([z.literal(''), z.string().email().max(254)]).optional(), kinds: z.array(z.enum(ALERT_KINDS)).optional() },
    (ctx, a) => svc.setNotificationPrefs(ctx, { email_enabled: a.email_enabled, email: a.email === undefined ? undefined : a.email || null, kinds: a.kinds }))

  register(server, 'send_alerts',
    'Collect the new alerts (thesis claims weakened/broken, sell/trim/buy signal changes, earnings within 3 days, watchlist targets hit) and email them. dry_run=true (default) only lists what would be sent. Requires alerts to be enabled.', WRITE,
    { dry_run: z.boolean().default(true) },
    (ctx, a) => sendAlerts(ctx, { dryRun: a.dry_run }))

  register(server, 'upsert_watchlist', 'Add a ticker to the watchlist or update its target price / thesis.', WRITE,
    { ticker, target_price: z.number().positive().nullable().optional(), thesis: z.string().max(20000).nullable().optional() },
    (ctx, a) => svc.upsertWatchlist(ctx, a.ticker, a))

  register(server, 'remove_from_watchlist', 'Delete a ticker from the watchlist.', DESTRUCTIVE, { ticker },
    (ctx, a) => svc.removeFromWatchlist(ctx, a.ticker))

  register(server, 'set_tags', 'Replace the theme tags of a ticker (holdings and/or watchlist).', WRITE,
    { ticker, tags: z.array(z.string().max(40)).max(20) },
    (ctx, a) => svc.setTags(ctx, a.ticker, a.tags))

  register(server, 'set_dca_plan', 'Create or restart a daily KRW DCA plan for a ticker.', WRITE,
    { ticker, amount_krw: z.number().positive(), from_date: isoDate },
    (ctx, a) => svc.setDcaPlan(ctx, a.ticker, a.amount_krw, a.from_date))

  register(server, 'stop_dca_plan', "Deactivate a ticker's DCA plan.", WRITE, { ticker },
    (ctx, a) => svc.stopDcaPlan(ctx, a.ticker))

  register(server, 'sync_dca',
    'Estimate the buys active DCA plans would have made (close price x that day USD/KRW). apply=false is a dry run; apply=true records them as buys.', WRITE,
    { ticker: ticker.optional(), apply: z.boolean().default(false) },
    (ctx, a) => svc.syncDca(ctx, a))

  register(server, 'set_investment_profile', "Replace the user's investment profile text.", WRITE,
    { content: z.string().max(20000) },
    (ctx, a) => svc.setProfile(ctx, a.content))

  register(server, 'analysis_context',
    'Everything the daily analysis needs in one call: investment profile, every holding and watchlist ticker with thesis, position, current price (fetched now and stored), previous analysis and upcoming events, plus the previous portfolio summary.',
    WRITE, {},
    (ctx) => svc.analysisContext(ctx))

  register(server, 'save_analysis',
    "Save today's analysis for one ticker (upsert by ticker+date). Held tickers need a holdings signal (add_more, hold, watch, trim, sell, urgent_sell, avoid_chasing); watchlist-only tickers a watchlist signal (buy, buy_wait, drop_watch).",
    WRITE,
    {
      ticker,
      date: isoDate,
      price: z.number().min(0),
      change_pct: z.number().nullable().optional(),
      signal: z.enum(SIGNALS),
      reasoning: z.string().min(1).max(4000),
    },
    (ctx, a) => svc.saveAnalysis(ctx, a))

  register(server, 'save_portfolio_analysis',
    "Save today's portfolio-level summary and optional watchlist top pick (must be on the watchlist).",
    WRITE,
    {
      date: isoDate,
      summary: z.string().min(1).max(4000),
      top_pick: ticker.optional(),
      top_pick_reason: z.string().max(1000).optional(),
    },
    (ctx, a) => svc.savePortfolioAnalysis(ctx, a))

  register(server, 'run_daily_analysis',
    "Run the analysis now for the listed tickers (default: holdings first, then watchlist, up to the server's per-run cap). Stores per-ticker signals and a portfolio summary. Runs on the user's own Anthropic API key saved in Settings; returns status 'skipped' with the reason when no key is available.", WRITE,
    { tickers: z.array(ticker).max(30).optional() },
    (ctx, a) => runDailyAnalysis(ctx, { tickers: a.tickers }))
}

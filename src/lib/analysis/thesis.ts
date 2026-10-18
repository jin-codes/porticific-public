import 'server-only'
import * as svc from '@/lib/portfolio/service'
import type { Ctx } from '@/lib/portfolio/service'
import { VERDICTS, type Verdict } from '@/lib/portfolio/calc'
import { callWithTool, client } from './daily'
import { NO_KEY_REASON, resolveAnthropicKey } from './credentials'

// Thesis validation loop. A buy thesis is split into falsifiable claims (proposeClaims); each claim
// is then re-judged against fresh facts as intact / weakened / broken (runThesisCheck) and the
// verdict history is kept, so "is my reason for owning this still true?" has a dated answer.

const PRINCIPLES = `You audit the user's own buy theses. This is a personal record, not investment advice.
- Judge each claim ONLY against what is verifiable: reported results, guidance, filings, price action, credible news. Say what the evidence is; never invent figures.
- A claim is "intact" when facts support it or nothing contradicts it, "weakened" when evidence is trending against it but its kill criteria are not met, "broken" only when the kill criteria are met or the claim is clearly false.
- Treat the previous verdict as the baseline. Without new evidence keep it and say "no new evidence since <date>". Change it only for a stated reason.
- If you have no basis to judge a claim, leave it out of your answer instead of guessing.
- Be skeptical of the thesis, not an advocate: look for the strongest fact against each claim before concluding.
- Evidence: 2-4 sentences, concrete. Write in the language of the claim.`

export interface ThesisCheckResult {
  status: 'ok' | 'skipped'
  reason?: string
  date?: string
  checked?: { ticker: string; claim: string; verdict: Verdict; previous: string }[]
  unassessed?: { ticker: string; claim: string }[]
  failed?: { ticker: string; error: string }[]
}

const model = () => process.env.ANALYSIS_MODEL ?? 'claude-haiku-5-5'

/** Break a ticker's free-text thesis into 3-6 falsifiable claims and store them (status 'unchecked'). */
export async function proposeClaims(ctx: Ctx, ticker: string) {
  const apiKey = await resolveAnthropicKey(ctx)
  if (!apiKey) return { status: 'skipped' as const, reason: NO_KEY_REASON }
  const t = ticker.trim().toUpperCase()
  const stock = await svc.getStock(ctx, t, 1)
  const thesis = stock.holding?.thesis ?? stock.watchlist?.thesis
  if (!thesis?.trim()) return { status: 'skipped' as const, reason: `${t} has no thesis text yet` }
  if (stock.thesis_claims.length) return { status: 'skipped' as const, reason: `${t} already has ${stock.thesis_claims.length} claims` }

  const out = await callWithTool<{ claims: { claim: string; kill_criteria: string }[] }>(client(apiKey), {
    model: model(),
    system: `You turn a buy thesis into falsifiable claims the user can track.
- 3-6 claims, each ONE checkable statement (a fact about the business or its trajectory), not a vague virtue like "strong company".
- For each, kill_criteria: the concrete observation that would prove the claim wrong (a metric crossing a level, a loss of a customer, a guidance cut).
- Stay faithful to the user's own reasoning and language; do not add reasons they did not give.`,
    user: JSON.stringify({ ticker: t, thesis }),
    webSearch: false,
    tool: {
      name: 'submit_claims',
      description: 'Submit the falsifiable claims extracted from the thesis.',
      input_schema: {
        type: 'object',
        properties: {
          claims: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            items: {
              type: 'object',
              properties: { claim: { type: 'string', maxLength: 300 }, kill_criteria: { type: 'string', maxLength: 300 } },
              required: ['claim', 'kill_criteria'],
            },
          },
        },
        required: ['claims'],
      },
    },
  })
  const saved = await svc.addClaims(ctx, t, out.claims)
  return { status: 'ok' as const, ticker: t, claims: saved }
}

/** Re-check every active claim (or one ticker's) against current facts and record the verdicts. */
export async function runThesisCheck(ctx: Ctx, opts: { ticker?: string; serverKeyOk?: boolean } = {}): Promise<ThesisCheckResult> {
  const apiKey = await resolveAnthropicKey(ctx, { serverKeyOk: opts.serverKeyOk })
  if (!apiKey) return { status: 'skipped', reason: NO_KEY_REASON }
  const webSearch = process.env.ANALYSIS_WEB_SEARCH === '1'
  const anthropic = client(apiKey)

  const context = await svc.thesisReviewContext(ctx, { ticker: opts.ticker })
  if (!context.items.length) return { status: 'skipped', reason: 'no thesis claims to check' }
  const { date, investment_profile: profile } = context

  const checked: NonNullable<ThesisCheckResult['checked']> = []
  const unassessed: NonNullable<ThesisCheckResult['unassessed']> = []
  const failed: NonNullable<ThesisCheckResult['failed']> = []

  // Same cap as the on-demand analysis; held tickers are checked before watchlist ones.
  const maxTickers = Number(process.env.ANALYSIS_MAX_TICKERS ?? 15)
  const items = [...context.items].sort((x, y) => Number(y.kind === 'holding') - Number(x.kind === 'holding')).slice(0, maxTickers)

  for (const item of items) {
    try {
      const out = await callWithTool<{ checks: { claim_id: string; verdict: Verdict; evidence: string }[] }>(anthropic, {
        model: model(),
        maxTokens: 8192,
        system: PRINCIPLES + (profile ? `\n\nInvestment profile (for context only):\n${profile}` : ''),
        user: JSON.stringify({
          today: date,
          ticker: item.ticker,
          kind: item.kind,
          thesis: item.thesis,
          position: item.position,
          price: item.price,
          change_pct: item.change_pct,
          upcoming_events: item.upcoming_events,
          claims: item.claims,
        }),
        webSearch,
        tool: {
          name: 'submit_checks',
          description: `Submit a verdict per claim for ${item.ticker}.`,
          input_schema: {
            type: 'object',
            properties: {
              checks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    claim_id: { type: 'string', enum: item.claims.map((c) => c.id) },
                    verdict: { type: 'string', enum: [...VERDICTS] },
                    evidence: { type: 'string', maxLength: 1500 },
                  },
                  required: ['claim_id', 'verdict', 'evidence'],
                },
              },
            },
            required: ['checks'],
          },
        },
      })
      const seen = new Set<string>()
      for (const c of out.checks) {
        const claim = item.claims.find((k) => k.id === c.claim_id)
        if (!claim || seen.has(c.claim_id) || !(VERDICTS as readonly string[]).includes(c.verdict)) continue
        seen.add(c.claim_id)
        await svc.saveThesisCheck(ctx, { claim_id: c.claim_id, verdict: c.verdict, evidence: c.evidence, date })
        checked.push({ ticker: item.ticker, claim: claim.claim, verdict: c.verdict, previous: claim.status })
      }
      for (const c of item.claims) if (!seen.has(c.id)) unassessed.push({ ticker: item.ticker, claim: c.claim })
    } catch (e) {
      failed.push({ ticker: item.ticker, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { status: 'ok', date, checked, unassessed, failed }
}

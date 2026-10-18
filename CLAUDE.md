# porticific

Portfolio journal as a service: holdings, buy theses, daily analysis and live
prices, usable from a web UI and from MCP clients (Claude etc.).

Stack: Next.js (App Router, TypeScript) on Vercel + Supabase (Postgres, Auth,
RLS). Google OAuth login.

## Conventions
- Schema changes: new file in `supabase/migrations/` only (never edit an applied one).
- Every per-user table has `user_id` + RLS with an owner SELECT policy and **no**
  write policies. All writes go through server code (service role) after the
  caller is verified. Buy/sell go through the `record_buy` / `record_sell` SQL
  functions (atomic, service_role only).
- Shared market data (`daily_snapshots`, `intraday_snapshots`, `market_events`)
  has no `user_id`; it is written by `scripts/fetch_*.py` (GitHub Actions cron)
  and by the price provider layer.
- Business logic lives in `src/lib/` and is shared by UI server actions and MCP
  tools. Keep route handlers/pages thin.
- Never commit `.env.local`. Never put real holdings or personal data in the repo.
- Price data goes through `src/lib/prices/` (provider interface).
- Tests: `npm test` (vitest).

## Where things are
- `src/lib/portfolio/calc.ts` — pure math (summary, tags, DCA estimate); `service.ts` — all DB access, takes a verified `Ctx`
- `src/lib/analysis/daily.ts` — on-demand analysis (Anthropic API). Key per run: the user's own key (BYOK, `credentials.ts`, AES-GCM encrypted with `KEY_ENCRYPTION_SECRET`), else the server `ANTHROPIC_API_KEY` for `OWNER_USER_ID` and the weekly thesis-check cron only. No automatic daily cron
- `src/mcp/` — MCP tools (`server.ts`), API-key auth, OAuth helpers; routes in `src/app/api/[transport]` and `src/app/api/mcp/oauth/*`
- `src/app/actions.ts` — UI server actions (zod-validated, always `requireCtx()` first)
- Run scripts with `node --env-file=.env.local node_modules/.bin/tsx <file>`
- After a migration: apply it to Supabase, then regenerate `src/lib/supabase/database.types.ts`

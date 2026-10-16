# porticific

A portfolio journal with buy theses, daily analysis and live prices, usable from a
web UI and from MCP clients (Claude Desktop / Claude.ai / Claude Code).

- **Web UI** — dashboard, per-stock page (thesis, analysis history, price chart, trades), watchlist, trades, settings
- **MCP server** — `/api/mcp`, 34 tools to read the portfolio and edit it (record buys/sells, thesis + thesis claims, watchlist, tags, DCA). OAuth (Claude.ai connectors) or API key
- **Daily analysis** — signal + reasoning per ticker against the buy thesis and the previous day's analysis, then a portfolio summary and a watchlist top pick (needs `ANTHROPIC_API_KEY`)
- **Security model** — every per-user table has `user_id` + RLS with an owner `SELECT` policy and no write policies; all writes go through the server. Buy/sell are atomic SQL functions only the service role can run

## Setup
```bash
cp .env.local.example .env.local   # fill in the values
npm install
npm run dev
```
1. Create a Supabase project and apply `supabase/migrations/` in order (CLI: `supabase db push`).
2. Enable the Google provider in Supabase Auth. Add `http://localhost:3000/auth/callback` (and your production URL) to the allowed redirect URLs; add `https://<ref>.supabase.co/auth/v1/callback` to the Google OAuth client.
3. Sign in once, then (optionally) turn off new sign-ups in Supabase Auth while it is single-user.

## Deploy (Vercel)
- Import the repo, set the env vars from `.env.local.example` (`CRON_SECRET` too, Vercel sends it to the cron routes).
- `vercel.json` schedules `/api/cron/prices` and `/api/cron/daily-analysis` on weekdays after the US close, `/api/cron/thesis-check` (thesis claim re-check) on Saturdays, and `/api/cron/alerts` daily (email digest, opt-in per user in Settings; needs `ALERT_SMTP_USER` / `ALERT_SMTP_PASS`, e.g. a Gmail app password). Vercel Hobby only allows daily crons.
- For intraday prices every 10 minutes, set the repo secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: `.github/workflows/fetch-prices.yml` then runs `scripts/fetch_prices.py`.
- Set `NEXT_PUBLIC_SITE_URL` to the production origin (shown on the settings page).

## Connect Claude
- **Claude.ai / Claude Desktop connectors**: add a custom connector with `https://<your-domain>/api/mcp`. It signs in with Google and shows a consent screen.
- **API key**: create one in Settings, then `claude mcp add --transport http porticific https://<your-domain>/api/mcp --header "Authorization: Bearer prt_..."`.

## Market data
Prices come from `src/lib/prices/` behind a provider interface. The default provider is unofficial (Yahoo) and **personal use only**; swap in a licensed provider before opening the service to other people.

## Develop
`npm run lint && npm run typecheck && npm test && npm run build`. See `CLAUDE.md` for conventions.

## License / disclaimer
MIT (see `LICENSE`). This is a personal journal tool, not investment advice. The default price provider uses Yahoo Finance through unofficial libraries (`yahoo-finance2`, `yfinance`) and is for personal use only; bring your own licensed data source before offering this to other people. Bring your own Supabase project and API keys: nothing here ships with credentials.

# porticific

**English** · [한국어](README.ko.md)

A portfolio journal as a service: record **why** you bought each holding, check that thesis every day, and see live prices — from a web UI or from any MCP client (Claude Desktop, Claude.ai, Claude Code).

> Personal journal tool, **not investment advice**. See [Disclaimer](#license--disclaimer).

## Features
- **Web UI** — dashboard, per-stock page (thesis, analysis history, price chart, trades), watchlist, trades, settings
- **MCP server** — `/api/mcp`, 34 tools to read the portfolio and edit it (record buys/sells, thesis and thesis claims, watchlist, tags, DCA plans). OAuth (Claude.ai connectors) or API key
- **Thesis tracking** — split a buy thesis into checkable claims and track *holding / weakened / broken* over time
- **Daily analysis** — a signal and reasoning per ticker against the buy thesis and the previous day's analysis, then a portfolio summary and a watchlist top pick (needs `ANTHROPIC_API_KEY`)
- **Email digest** — opt-in alerts for signal changes and upcoming events
- **Security model** — every per-user table has `user_id` + RLS with an owner `SELECT` policy and no write policies. All writes go through the server after the caller is verified. Buy/sell are atomic SQL functions only the service role can run

## Stack
Next.js (App Router, TypeScript) · Supabase (Postgres, Auth, RLS) · Google OAuth · Anthropic API · deployable on Vercel

## Setup
```bash
cp .env.local.example .env.local   # fill in the values
npm install
npm run dev
```
1. Create a Supabase project and apply `supabase/migrations/` in order (CLI: `supabase db push`).
2. Enable the Google provider in Supabase Auth. Add `http://localhost:3000/auth/callback` (and your production URL) to the allowed redirect URLs, and add `https://<ref>.supabase.co/auth/v1/callback` to the Google OAuth client.
3. Sign in once, then (optionally) turn off new sign-ups in Supabase Auth while it is single-user.

## Deploy (Vercel)
- Import the repo and set the env vars from `.env.local.example` (including `CRON_SECRET`, which Vercel sends to the cron routes).
- `vercel.json` schedules `/api/cron/prices` and `/api/cron/daily-analysis` on weekdays after the US close, `/api/cron/thesis-check` on Saturdays, and `/api/cron/alerts` daily (email digest, opt-in per user in Settings; needs `ALERT_SMTP_USER` / `ALERT_SMTP_PASS`, e.g. a Gmail app password). Vercel Hobby only allows daily crons.
- For intraday prices every 10 minutes, set the repo secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; `.github/workflows/fetch-prices.yml` then runs `scripts/fetch_prices.py`.
- Set `NEXT_PUBLIC_SITE_URL` to the production origin (shown on the settings page).

## Connect Claude
- **Claude.ai / Claude Desktop connector**: add a custom connector with `https://<your-domain>/api/mcp`. It signs in with Google and shows a consent screen.
- **API key**: create one in Settings, then
  ```bash
  claude mcp add --transport http porticific https://<your-domain>/api/mcp \
    --header "Authorization: Bearer prt_..."
  ```

## Market data
Prices come from `src/lib/prices/` behind a provider interface. The default provider is unofficial (Yahoo Finance) and **for personal use only**. Replace it with a licensed provider before offering the service to other people.

## Develop
```bash
npm run lint && npm run typecheck && npm test && npm run build
```
Business logic lives in `src/lib/` and is shared by the UI server actions and the MCP tools. See [`CLAUDE.md`](CLAUDE.md) for conventions. Schema changes go in a new file under `supabase/migrations/` (never edit an applied one).

## License / disclaimer
MIT, see [`LICENSE`](LICENSE). Nothing here is investment advice, and prices may be delayed or inaccurate. The default price provider uses Yahoo Finance through unofficial libraries (`yahoo-finance2`, `yfinance`) for personal use only. Bring your own Supabase project and API keys: this repo ships with no credentials.

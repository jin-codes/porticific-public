-- porticific baseline schema.
--
-- Security model:
--   * Per-user tables carry user_id (-> auth.users) and have RLS with an
--     owner SELECT policy only. There are no INSERT/UPDATE/DELETE policies:
--     every write goes through the server (service role) after the caller's
--     identity is verified, so the browser can never edit the ledger directly.
--   * Market-data tables (snapshots, events) are shared across users: any
--     signed-in user can read, only the service role (cron) writes.
--   * Ledger functions are SECURITY DEFINER, take p_user_id explicitly, and
--     are executable by service_role only.

create extension if not exists "pgcrypto";

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- user data

create table investment_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  content    text not null default '',   -- risk tolerance / horizon / concentration rules
  updated_at timestamptz not null default now()
);

create table holdings (
  user_id        uuid not null references auth.users(id) on delete cascade,
  ticker         text not null,
  quantity       numeric not null check (quantity >= 0),
  avg_cost       numeric not null check (avg_cost >= 0),
  first_buy_date date not null,
  thesis         text,
  tags           text[] not null default '{}',
  updated_at     timestamptz not null default now(),
  primary key (user_id, ticker)
);

create table watchlist (
  user_id      uuid not null references auth.users(id) on delete cascade,
  ticker       text not null,
  target_price numeric,
  thesis       text,
  tags         text[] not null default '{}',
  added_at     timestamptz not null default now(),
  primary key (user_id, ticker)
);

create table buys (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  ticker     text not null,
  quantity   numeric not null check (quantity > 0),
  buy_price  numeric not null check (buy_price >= 0),
  buy_date   date not null,
  source     text not null default 'manual' check (source in ('manual', 'csv', 'dca_estimate')),
  note       text,
  created_at timestamptz not null default now()
);
create index buys_user_ticker_date_idx on buys (user_id, ticker, buy_date desc);

create table trades (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  ticker       text not null,
  quantity     numeric not null check (quantity > 0),
  sell_price   numeric not null check (sell_price >= 0),
  cost_basis   numeric not null check (cost_basis >= 0),  -- avg_cost per share at time of sale
  realized_pnl numeric generated always as ((sell_price - cost_basis) * quantity) stored,
  sell_date    date not null,
  note         text,
  created_at   timestamptz not null default now()
);
create index trades_user_ticker_date_idx on trades (user_id, ticker, sell_date desc);

create table dca_plans (
  user_id          uuid not null references auth.users(id) on delete cascade,
  ticker           text not null,
  daily_amount_krw numeric not null check (daily_amount_krw > 0),
  start_date       date not null,
  last_synced_date date,
  active           boolean not null default true,
  updated_at       timestamptz not null default now(),
  primary key (user_id, ticker)
);

create table daily_analysis (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  ticker     text not null,
  date       date not null,
  price      numeric not null,
  change_pct numeric,
  signal     text not null check (signal in (
    'add_more',      -- thesis reinforced, grounds to add to the position (holdings)
    'hold',          -- thesis still holds, no change (holdings)
    'watch',         -- thesis mostly holds but an early warning sign appeared (holdings)
    'trim',          -- partial profit-taking / risk reduction, not a full exit (holdings)
    'sell',          -- thesis broken, grounds to exit (holdings)
    'urgent_sell',   -- serious bad news, immediate exit recommended (holdings)
    'avoid_chasing', -- position ran up short-term, don't add more now (holdings)
    'buy',           -- grounds for a new entry (watchlist)
    'buy_wait',      -- thesis holds but not the entry point yet (watchlist)
    'drop_watch'     -- thesis never held or fell apart, drop from watchlist (watchlist)
  )),
  reasoning  text,
  updated_at timestamptz not null default now(),
  unique (user_id, ticker, date)
);
create index daily_analysis_user_ticker_date_idx on daily_analysis (user_id, ticker, date desc);

create table portfolio_analysis (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  date            date not null,
  summary         text not null,
  top_pick        text,
  top_pick_reason text,
  updated_at      timestamptz not null default now(),
  unique (user_id, date)
);

create table alert_log (
  user_id   uuid not null references auth.users(id) on delete cascade,
  alert_key text not null,
  message   text not null,
  sent_at   timestamptz not null default now(),
  primary key (user_id, alert_key)
);

-- -------------------------------------------------------- shared market data

create table daily_snapshots (
  id         uuid primary key default gen_random_uuid(),
  ticker     text not null,
  date       date not null,
  price      numeric not null,
  change_pct numeric,
  volume     bigint,
  note       text,
  unique (ticker, date)
);
create index daily_snapshots_ticker_date_idx on daily_snapshots (ticker, date desc);

create table intraday_snapshots (
  id         uuid primary key default gen_random_uuid(),
  ticker     text not null,
  ts         timestamptz not null default now(),
  price      numeric not null,
  change_pct numeric,
  volume     bigint
);
create index intraday_snapshots_ticker_ts_idx on intraday_snapshots (ticker, ts desc);

create table market_events (
  id         uuid primary key default gen_random_uuid(),
  ticker     text not null,
  event_date date not null,
  kind       text not null check (kind in ('earnings', 'ex_dividend', 'macro')),
  title      text,
  source     text not null default 'provider',
  updated_at timestamptz not null default now(),
  unique (ticker, event_date, kind)
);
create index market_events_date_idx on market_events (event_date);

-- ------------------------------------------------------------------ triggers

create trigger holdings_set_updated_at before update on holdings
  for each row execute function set_updated_at();
create trigger dca_plans_set_updated_at before update on dca_plans
  for each row execute function set_updated_at();
create trigger daily_analysis_set_updated_at before update on daily_analysis
  for each row execute function set_updated_at();
create trigger portfolio_analysis_set_updated_at before update on portfolio_analysis
  for each row execute function set_updated_at();
create trigger investment_profiles_set_updated_at before update on investment_profiles
  for each row execute function set_updated_at();
create trigger market_events_set_updated_at before update on market_events
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------- RLS

alter table investment_profiles enable row level security;
alter table holdings            enable row level security;
alter table watchlist           enable row level security;
alter table buys                enable row level security;
alter table trades              enable row level security;
alter table dca_plans           enable row level security;
alter table daily_analysis      enable row level security;
alter table portfolio_analysis  enable row level security;
alter table alert_log           enable row level security;
alter table daily_snapshots     enable row level security;
alter table intraday_snapshots  enable row level security;
alter table market_events       enable row level security;

create policy investment_profiles_owner_select on investment_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy holdings_owner_select            on holdings            for select to authenticated using (user_id = (select auth.uid()));
create policy watchlist_owner_select           on watchlist           for select to authenticated using (user_id = (select auth.uid()));
create policy buys_owner_select                on buys                for select to authenticated using (user_id = (select auth.uid()));
create policy trades_owner_select              on trades              for select to authenticated using (user_id = (select auth.uid()));
create policy dca_plans_owner_select           on dca_plans           for select to authenticated using (user_id = (select auth.uid()));
create policy daily_analysis_owner_select      on daily_analysis      for select to authenticated using (user_id = (select auth.uid()));
create policy portfolio_analysis_owner_select  on portfolio_analysis  for select to authenticated using (user_id = (select auth.uid()));
create policy alert_log_owner_select           on alert_log           for select to authenticated using (user_id = (select auth.uid()));

create policy daily_snapshots_read    on daily_snapshots    for select to authenticated using (true);
create policy intraday_snapshots_read on intraday_snapshots for select to authenticated using (true);
create policy market_events_read      on market_events      for select to authenticated using (true);

-- -------------------------------------------------------------------- grants
-- Explicit, so we don't depend on the project's default privileges.

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- ------------------------------------------------------------ ledger functions
-- Atomic versions of scripts/lib/ledger.py apply_buy / apply_sell: the ledger
-- row and the holdings change commit or roll back together.

create or replace function record_buy(
  p_user_id  uuid,
  p_ticker   text,
  p_quantity numeric,
  p_price    numeric,
  p_date     date,
  p_source   text default 'manual',
  p_note     text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticker  text := upper(p_ticker);
  v_holding holdings%rowtype;
  v_qty     numeric;
  v_avg     numeric;
begin
  if p_quantity <= 0 or p_price < 0 then
    raise exception '%: invalid buy quantity=% price=%', v_ticker, p_quantity, p_price;
  end if;

  insert into buys (user_id, ticker, quantity, buy_price, buy_date, source, note)
  values (p_user_id, v_ticker, p_quantity, p_price, p_date, p_source, p_note);

  select * into v_holding from holdings
   where user_id = p_user_id and ticker = v_ticker for update;

  if not found then
    insert into holdings (user_id, ticker, quantity, avg_cost, first_buy_date)
    values (p_user_id, v_ticker, p_quantity, p_price, p_date);
    return jsonb_build_object('ticker', v_ticker, 'quantity', p_quantity, 'avg_cost', p_price, 'status', 'opened');
  end if;

  v_qty := v_holding.quantity + p_quantity;
  v_avg := (v_holding.quantity * v_holding.avg_cost + p_quantity * p_price) / v_qty;

  update holdings
     set quantity = v_qty,
         avg_cost = v_avg,
         first_buy_date = least(first_buy_date, p_date)  -- a backdated buy can predate the first one
   where user_id = p_user_id and ticker = v_ticker;

  return jsonb_build_object('ticker', v_ticker, 'quantity', v_qty, 'avg_cost', v_avg, 'status', 'increased');
end;
$$;

create or replace function record_sell(
  p_user_id  uuid,
  p_ticker   text,
  p_quantity numeric,
  p_price    numeric,
  p_date     date,
  p_note     text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticker    text := upper(p_ticker);
  v_holding   holdings%rowtype;
  v_remaining numeric;
  v_trade_id  uuid;
begin
  select * into v_holding from holdings
   where user_id = p_user_id and ticker = v_ticker for update;
  if not found then
    raise exception '% is not in holdings', v_ticker;
  end if;
  if p_quantity <= 0 or p_quantity > v_holding.quantity + 1e-9 then
    raise exception 'Sell quantity (%) must be > 0 and <= held quantity (%)', p_quantity, v_holding.quantity;
  end if;

  insert into trades (user_id, ticker, quantity, sell_price, cost_basis, sell_date, note)
  values (p_user_id, v_ticker, p_quantity, p_price, v_holding.avg_cost, p_date, p_note)
  returning id into v_trade_id;

  v_remaining := v_holding.quantity - p_quantity;
  if v_remaining <= 1e-9 then
    delete from holdings where user_id = p_user_id and ticker = v_ticker;
    return jsonb_build_object('trade_id', v_trade_id, 'status', 'fully_sold');
  end if;

  update holdings set quantity = v_remaining where user_id = p_user_id and ticker = v_ticker;
  return jsonb_build_object('trade_id', v_trade_id, 'status', 'partially_sold', 'remaining', v_remaining);
end;
$$;

revoke all on function record_buy(uuid, text, numeric, numeric, date, text, text) from public, anon, authenticated;
revoke all on function record_sell(uuid, text, numeric, numeric, date, text)      from public, anon, authenticated;
grant execute on function record_buy(uuid, text, numeric, numeric, date, text, text) to service_role;
grant execute on function record_sell(uuid, text, numeric, numeric, date, text)      to service_role;

-- Cash tracking (single currency: USD, the portfolio's currency).
--
-- cash_events is a signed ledger: balance = sum(amount). Manual kinds are deposit (+),
-- withdrawal (-), dividend (+) and adjustment (+/-, from set_cash_balance); buy (-) and
-- sell (+) rows are written by record_buy / record_sell.
--
-- Tracking is opt-in: until the user records a first manual cash event there is no baseline,
-- so trades write no cash rows. Afterwards a trade moves cash automatically unless
-- p_affect_cash is false, and only if the trade date is on/after the first cash event
-- (older trades are already reflected in the baseline balance the user entered).

create table cash_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  date       date not null,
  amount     numeric not null check (amount <> 0),
  kind       text not null check (kind in ('deposit', 'withdrawal', 'dividend', 'adjustment', 'buy', 'sell')),
  ticker     text,
  ref_id     uuid,            -- buys.id / trades.id for buy / sell rows
  note       text,
  created_at timestamptz not null default now()
);
create index cash_events_user_date_idx on cash_events (user_id, date desc, created_at desc);

alter table cash_events enable row level security;
create policy cash_events_owner_select on cash_events
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on cash_events from anon, authenticated;
grant select on cash_events to authenticated;
grant all on cash_events to service_role;

-- Manual cash movement. deposit/dividend must be positive, withdrawal positive (stored negative).
create or replace function record_cash_event(
  p_user_id uuid,
  p_kind    text,
  p_amount  numeric,
  p_date    date,
  p_note    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric;
begin
  if p_kind not in ('deposit', 'withdrawal', 'dividend') then
    raise exception 'kind must be deposit, withdrawal or dividend (use set_cash_balance to adjust)';
  end if;
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  v_amount := case when p_kind = 'withdrawal' then -p_amount else p_amount end;

  insert into cash_events (user_id, date, amount, kind, note) values (p_user_id, p_date, v_amount, p_kind, p_note);
  return jsonb_build_object('kind', p_kind, 'amount', v_amount,
    'balance', (select coalesce(sum(amount), 0) from cash_events where user_id = p_user_id));
end;
$$;

-- Set the cash balance to an exact figure by recording the difference as an adjustment.
create or replace function set_cash_balance(
  p_user_id uuid,
  p_balance numeric,
  p_date    date,
  p_note    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current numeric;
  v_diff    numeric;
begin
  if p_balance < 0 then
    raise exception 'balance cannot be negative';
  end if;
  -- serialise concurrent cash writes for this user
  perform pg_advisory_xact_lock(hashtext('cash:' || p_user_id::text));
  select coalesce(sum(amount), 0) into v_current from cash_events where user_id = p_user_id;
  v_diff := p_balance - v_current;
  if v_diff <> 0 then
    insert into cash_events (user_id, date, amount, kind, note)
    values (p_user_id, p_date, v_diff, 'adjustment', coalesce(p_note, 'balance set'));
  elsif not exists (select 1 from cash_events where user_id = p_user_id) then
    -- balance 0 on a fresh account still needs a baseline marker: a zero row is not allowed,
    -- so refuse instead of silently doing nothing
    raise exception 'nothing to record: balance is already 0 and no cash events exist';
  end if;
  return jsonb_build_object('balance', p_balance, 'adjustment', v_diff);
end;
$$;

-- Replace the ledger functions: same logic as before plus the optional cash side effect.
drop function if exists record_buy(uuid, text, numeric, numeric, date, text, text);
drop function if exists record_sell(uuid, text, numeric, numeric, date, text);

create or replace function record_buy(
  p_user_id     uuid,
  p_ticker      text,
  p_quantity    numeric,
  p_price       numeric,
  p_date        date,
  p_source      text default 'manual',
  p_note        text default null,
  p_affect_cash boolean default true
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
  v_buy_id  uuid;
  v_first   date;
  v_status  text;
begin
  if p_quantity <= 0 or p_price < 0 then
    raise exception '%: invalid buy quantity=% price=%', v_ticker, p_quantity, p_price;
  end if;

  perform pg_advisory_xact_lock(hashtext('cash:' || p_user_id::text));

  insert into buys (user_id, ticker, quantity, buy_price, buy_date, source, note)
  values (p_user_id, v_ticker, p_quantity, p_price, p_date, p_source, p_note)
  returning id into v_buy_id;

  select * into v_holding from holdings
   where user_id = p_user_id and ticker = v_ticker for update;

  if not found then
    insert into holdings (user_id, ticker, quantity, avg_cost, first_buy_date)
    values (p_user_id, v_ticker, p_quantity, p_price, p_date);
    v_qty := p_quantity; v_avg := p_price; v_status := 'opened';
  else
    v_qty := v_holding.quantity + p_quantity;
    v_avg := (v_holding.quantity * v_holding.avg_cost + p_quantity * p_price) / v_qty;
    update holdings
       set quantity = v_qty,
           avg_cost = v_avg,
           first_buy_date = least(first_buy_date, p_date)  -- a backdated buy can predate the first one
     where user_id = p_user_id and ticker = v_ticker;
    v_status := 'increased';
  end if;

  if p_affect_cash and p_quantity * p_price > 0 then
    select min(date) into v_first from cash_events where user_id = p_user_id;
    if v_first is not null and p_date >= v_first then
      insert into cash_events (user_id, date, amount, kind, ticker, ref_id, note)
      values (p_user_id, p_date, -(p_quantity * p_price), 'buy', v_ticker, v_buy_id, p_note);
    end if;
  end if;

  return jsonb_build_object('ticker', v_ticker, 'quantity', v_qty, 'avg_cost', v_avg, 'status', v_status,
    'cash_balance', (select case when exists (select 1 from cash_events where user_id = p_user_id)
                                 then (select sum(amount) from cash_events where user_id = p_user_id) end));
end;
$$;

create or replace function record_sell(
  p_user_id     uuid,
  p_ticker      text,
  p_quantity    numeric,
  p_price       numeric,
  p_date        date,
  p_note        text default null,
  p_affect_cash boolean default true
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
  v_first     date;
  v_status    text;
begin
  perform pg_advisory_xact_lock(hashtext('cash:' || p_user_id::text));

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
    v_status := 'fully_sold';
  else
    update holdings set quantity = v_remaining where user_id = p_user_id and ticker = v_ticker;
    v_status := 'partially_sold';
  end if;

  if p_affect_cash and p_quantity * p_price > 0 then
    select min(date) into v_first from cash_events where user_id = p_user_id;
    if v_first is not null and p_date >= v_first then
      insert into cash_events (user_id, date, amount, kind, ticker, ref_id, note)
      values (p_user_id, p_date, p_quantity * p_price, 'sell', v_ticker, v_trade_id, p_note);
    end if;
  end if;

  return jsonb_build_object('trade_id', v_trade_id, 'status', v_status, 'remaining', greatest(v_remaining, 0),
    'cash_balance', (select case when exists (select 1 from cash_events where user_id = p_user_id)
                                 then (select sum(amount) from cash_events where user_id = p_user_id) end));
end;
$$;

revoke all on function record_cash_event(uuid, text, numeric, date, text) from public, anon, authenticated;
revoke all on function set_cash_balance(uuid, numeric, date, text)        from public, anon, authenticated;
revoke all on function record_buy(uuid, text, numeric, numeric, date, text, text, boolean) from public, anon, authenticated;
revoke all on function record_sell(uuid, text, numeric, numeric, date, text, boolean)      from public, anon, authenticated;
grant execute on function record_cash_event(uuid, text, numeric, date, text) to service_role;
grant execute on function set_cash_balance(uuid, numeric, date, text)        to service_role;
grant execute on function record_buy(uuid, text, numeric, numeric, date, text, text, boolean) to service_role;
grant execute on function record_sell(uuid, text, numeric, numeric, date, text, boolean)      to service_role;

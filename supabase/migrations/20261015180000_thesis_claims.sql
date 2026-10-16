-- Thesis validation loop.
--
-- A buy thesis is free text. thesis_claims breaks it into falsifiable statements, each with
-- the condition that would prove it wrong (kill_criteria). thesis_checks is the append-only
-- history of verdicts; thesis_claims.status / last_* mirror the latest check for cheap reads.
-- Claims belong to a ticker (holding or watchlist), not to a position, so they survive
-- a full sell and re-buy.

create table thesis_claims (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  ticker         text not null,
  claim          text not null check (length(claim) between 1 and 500),
  kill_criteria  text check (length(kill_criteria) <= 500),
  status         text not null default 'unchecked' check (status in ('unchecked', 'intact', 'weakened', 'broken')),
  last_checked   date,
  last_evidence  text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index thesis_claims_user_ticker_idx on thesis_claims (user_id, ticker) where active;

create table thesis_checks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  claim_id   uuid not null references thesis_claims(id) on delete cascade,
  ticker     text not null,
  date       date not null,
  verdict    text not null check (verdict in ('intact', 'weakened', 'broken')),
  evidence   text not null check (length(evidence) <= 4000),
  created_at timestamptz not null default now(),
  unique (claim_id, date)
);
create index thesis_checks_user_ticker_date_idx on thesis_checks (user_id, ticker, date desc);

create trigger thesis_claims_set_updated_at before update on thesis_claims
  for each row execute function set_updated_at();

alter table thesis_claims enable row level security;
alter table thesis_checks enable row level security;
create policy thesis_claims_owner_select on thesis_claims for select to authenticated using (user_id = (select auth.uid()));
create policy thesis_checks_owner_select on thesis_checks for select to authenticated using (user_id = (select auth.uid()));

revoke all on thesis_claims, thesis_checks from anon, authenticated;
grant select on thesis_claims, thesis_checks to authenticated;
grant all on thesis_claims, thesis_checks to service_role;

-- Record a verdict and refresh the claim's mirror columns in one transaction.
-- A later check on the same day replaces the earlier one.
create or replace function record_thesis_check(
  p_user_id  uuid,
  p_claim_id uuid,
  p_date     date,
  p_verdict  text,
  p_evidence text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim thesis_claims%rowtype;
begin
  select * into v_claim from thesis_claims where id = p_claim_id and user_id = p_user_id for update;
  if not found then
    raise exception 'claim not found';
  end if;

  insert into thesis_checks (user_id, claim_id, ticker, date, verdict, evidence)
  values (p_user_id, p_claim_id, v_claim.ticker, p_date, p_verdict, p_evidence)
  on conflict (claim_id, date) do update set verdict = excluded.verdict, evidence = excluded.evidence;

  -- only move the mirror forward, so back-dated entries don't overwrite a newer verdict
  if v_claim.last_checked is null or p_date >= v_claim.last_checked then
    update thesis_claims
       set status = p_verdict, last_checked = p_date, last_evidence = p_evidence
     where id = p_claim_id;
  end if;

  return jsonb_build_object('claim_id', p_claim_id, 'ticker', v_claim.ticker, 'verdict', p_verdict, 'date', p_date);
end;
$$;

revoke all on function record_thesis_check(uuid, uuid, date, text, text) from public, anon, authenticated;
grant execute on function record_thesis_check(uuid, uuid, date, text, text) to service_role;

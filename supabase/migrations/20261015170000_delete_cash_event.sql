-- Delete a manually entered cash event (deposit / withdrawal / dividend / adjustment).
-- buy / sell rows are tied to the ledger (buys / trades) and cannot be deleted here.
-- If no manual event remains afterwards, cash tracking is switched off: the leftover
-- buy / sell rows are removed too, so the account is back to "not tracked" (balance null).
create or replace function delete_cash_event(
  p_user_id uuid,
  p_id      uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind  text;
  v_reset boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('cash:' || p_user_id::text));

  select kind into v_kind from cash_events where id = p_id and user_id = p_user_id;
  if not found then
    raise exception 'cash event not found';
  end if;
  if v_kind in ('buy', 'sell') then
    raise exception 'buy/sell cash rows follow the ledger and cannot be deleted';
  end if;

  delete from cash_events where id = p_id and user_id = p_user_id;

  if not exists (select 1 from cash_events where user_id = p_user_id and kind not in ('buy', 'sell')) then
    delete from cash_events where user_id = p_user_id;
    v_reset := true;
  end if;

  return jsonb_build_object(
    'deleted', p_id,
    'tracking_reset', v_reset,
    'balance', (select case when exists (select 1 from cash_events where user_id = p_user_id)
                            then (select sum(amount) from cash_events where user_id = p_user_id) end)
  );
end;
$$;

revoke all on function delete_cash_event(uuid, uuid) from public, anon, authenticated;
grant execute on function delete_cash_event(uuid, uuid) to service_role;

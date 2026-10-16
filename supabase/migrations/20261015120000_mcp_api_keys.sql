-- API keys for MCP clients that send `Authorization: Bearer prt_...`.
-- Only the SHA-256 hash is stored; the raw key is shown once at creation.
-- Writes go through the server (service role), like every other per-user table.
create table mcp_api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  key_hash     text not null unique,
  key_prefix   text not null,            -- first characters, to recognise a key in the UI
  name         text not null default 'API key',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index mcp_api_keys_user_id_idx on mcp_api_keys (user_id);

alter table mcp_api_keys enable row level security;
create policy mcp_api_keys_owner_select on mcp_api_keys
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on mcp_api_keys from anon, authenticated;
grant select (id, user_id, key_prefix, name, created_at, last_used_at, revoked_at) on mcp_api_keys to authenticated;
grant all on mcp_api_keys to service_role;

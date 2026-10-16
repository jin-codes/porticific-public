-- OAuth 2.1 (authorization_code + PKCE) for MCP clients that cannot send a static
-- API key, e.g. Claude.ai connectors. Ported from verilix.
-- All writes go through the server (service role).

-- Dynamic Client Registration (RFC 7591) targets: public clients only (PKCE, no secret).
create table mcp_oauth_clients (
  id            uuid primary key default gen_random_uuid(),
  client_id     text not null unique,
  redirect_uris text[] not null,
  client_name   text,
  created_at    timestamptz not null default now()
);

-- authorization_code grant codes: single use, short TTL (hash only).
create table mcp_oauth_codes (
  id                    uuid primary key default gen_random_uuid(),
  code_hash             text not null unique,
  client_id             text not null references mcp_oauth_clients(client_id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  redirect_uri          text not null,
  code_challenge        text not null,
  code_challenge_method text not null default 'S256',
  scope                 text,
  expires_at            timestamptz not null,
  used_at               timestamptz,
  created_at            timestamptz not null default now()
);
create index mcp_oauth_codes_user_id_idx on mcp_oauth_codes (user_id);

-- Issued access + refresh tokens (hashes only).
create table mcp_oauth_tokens (
  id                 uuid primary key default gen_random_uuid(),
  access_token_hash  text not null unique,
  refresh_token_hash text unique,
  client_id          text not null references mcp_oauth_clients(client_id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  scope              text,
  expires_at         timestamptz not null,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz
);
create index mcp_oauth_tokens_user_id_idx on mcp_oauth_tokens (user_id);

alter table mcp_oauth_clients enable row level security;
alter table mcp_oauth_codes   enable row level security;
alter table mcp_oauth_tokens  enable row level security;

-- Client metadata is public by design (no secret); signed-in users may read it
-- so the settings page can show which app they connected.
create policy mcp_oauth_clients_read on mcp_oauth_clients for select to authenticated using (true);
create policy mcp_oauth_tokens_owner_select on mcp_oauth_tokens for select to authenticated using (user_id = (select auth.uid()));

revoke all on mcp_oauth_clients, mcp_oauth_codes, mcp_oauth_tokens from anon, authenticated;
grant select on mcp_oauth_clients to authenticated;
grant select (id, client_id, user_id, scope, expires_at, revoked_at, created_at, last_used_at) on mcp_oauth_tokens to authenticated;
grant all on mcp_oauth_clients, mcp_oauth_codes, mcp_oauth_tokens to service_role;

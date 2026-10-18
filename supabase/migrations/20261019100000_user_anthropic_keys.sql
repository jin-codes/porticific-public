-- Bring-your-own-key: a user's own Anthropic API key, used only for the analysis they run themselves.
-- The key is stored encrypted (AES-256-GCM, secret in the server env); the browser role can read
-- only the non-secret columns, and nothing but server code with the service role can read or write it.
create table user_anthropic_keys (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  ciphertext  text not null,
  key_hint    text not null,          -- last 4 characters, to recognise the key in the UI
  created_at  timestamptz not null default now()
);

alter table user_anthropic_keys enable row level security;
create policy user_anthropic_keys_owner_select on user_anthropic_keys
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on user_anthropic_keys from anon, authenticated;
grant select (user_id, key_hint, created_at) on user_anthropic_keys to authenticated;
grant all on user_anthropic_keys to service_role;

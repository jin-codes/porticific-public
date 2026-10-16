-- Email alerts are opt-in. One row per user; no row means "off".
-- email overrides the login address when set. kinds limits which alert kinds are sent
-- (see src/lib/notify/digest.ts ALERT_KINDS). Dedupe of already-sent alerts uses alert_log.

create table notification_prefs (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  email_enabled boolean not null default false,
  email         text check (length(email) <= 254),
  kinds         text[] not null default '{thesis,signal,event,target}',
  updated_at    timestamptz not null default now(),
  check (kinds <@ array['thesis', 'signal', 'event', 'target']::text[])
);

create trigger notification_prefs_set_updated_at before update on notification_prefs
  for each row execute function set_updated_at();

alter table notification_prefs enable row level security;
create policy notification_prefs_owner_select on notification_prefs
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on notification_prefs from anon, authenticated;
grant select on notification_prefs to authenticated;
grant all on notification_prefs to service_role;

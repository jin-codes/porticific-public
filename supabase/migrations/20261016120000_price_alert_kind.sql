-- Add the 'price' alert kind (intraday move beyond a threshold). Opt-in for email: the column default
-- is unchanged, so existing users do not suddenly get it in their daily digest.
alter table notification_prefs drop constraint notification_prefs_kinds_check;
alter table notification_prefs
  add constraint notification_prefs_kinds_check
  check (kinds <@ array['thesis', 'signal', 'event', 'target', 'price']::text[]);

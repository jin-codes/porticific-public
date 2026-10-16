-- mcp_oauth_codes is service-role only. State that explicitly instead of relying on
-- "RLS enabled, no policy" (same effect, but the linter flags the implicit form).
create policy mcp_oauth_codes_no_client_access on mcp_oauth_codes
  for all to anon, authenticated using (false) with check (false);

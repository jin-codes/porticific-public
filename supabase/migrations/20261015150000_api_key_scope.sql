-- Keys can be limited to the daily-analysis tools: a headless agent that reads web pages
-- must not hold a key that can record trades or overwrite holdings.
alter table mcp_api_keys
  add column scope text not null default 'full' check (scope in ('full', 'analysis'));

grant select (scope) on mcp_api_keys to authenticated;

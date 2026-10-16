-- A third key scope for delivery bots: 'digest' can only call GET /api/digest and POST /api/digest/ack
-- (read the latest summary + unsent alerts, mark them delivered). It has no MCP tool access at all.
alter table mcp_api_keys drop constraint mcp_api_keys_scope_check;
alter table mcp_api_keys
  add constraint mcp_api_keys_scope_check check (scope in ('full', 'analysis', 'digest'));

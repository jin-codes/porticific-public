// Which MCP tools an API key scope may call. Pure so it can be tested.

export type KeyScope = 'full' | 'analysis' | 'digest'

// Keys with scope 'analysis' (used by the headless daily-analysis agent) may only call these.
export const ANALYSIS_SCOPE_TOOLS = new Set([
  'analysis_context',
  'get_investment_profile',
  'get_analysis',
  'get_portfolio_analysis',
  'get_stock',
  'get_prices',
  'upcoming_events',
  'save_analysis',
  'save_portfolio_analysis',
  'thesis_review_context',
  'save_thesis_check',
])

export function parseScope(raw: unknown): KeyScope {
  return raw === 'analysis' || raw === 'digest' ? raw : 'full'
}

/** OAuth tokens carry no scope here (undefined) and keep full access, as before. */
export function toolAllowed(scope: unknown, tool: string): boolean {
  if (scope === 'digest') return false
  if (scope === 'analysis') return ANALYSIS_SCOPE_TOOLS.has(tool)
  return true
}

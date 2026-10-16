import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { configureMcpServer } from '@/mcp/server'
import { verifyApiKey } from '@/mcp/auth'
import { verifyOAuthAccessToken } from '@/mcp/oauth'
import { ALLOWED_SCOPES } from '@/mcp/oauth'

const handler = createMcpHandler(
  (server) => configureMcpServer(server),
  {
    instructions:
      "This connector is the user's personal portfolio journal. Read tools: portfolio_summary, get_stock (holding/watchlist, buy thesis, analysis, ledger, events), get_prices (live or stored), get_analysis, report, upcoming_events. " +
      'Write tools change real records: record_buy / record_sell update the ledger and holdings, set_thesis edits the buy thesis, correct_holding overwrites data without a ledger row (use only to fix mistakes). ' +
      'Only write when the user asked for it. Always read get_investment_profile before judging signals. Nothing here is investment advice; present analysis as the user\'s own notes and data.',
  },
  { basePath: '/api', maxDuration: 60 }
)

const authHandler = withMcpAuth(
  handler,
  async (_req, bearerToken) => {
    if (!bearerToken) return undefined

    // prt_ = static API key issued in Settings; prto_ = OAuth access token (e.g. Claude.ai connector)
    if (bearerToken.startsWith('prt_')) {
      const verified = await verifyApiKey(bearerToken)
      if (!verified) return undefined
      return {
        token: bearerToken,
        clientId: verified.userId,
        scopes: ALLOWED_SCOPES,
        extra: { userId: verified.userId, apiKeyId: verified.apiKeyId, scope: verified.scope },
      }
    }

    const verified = await verifyOAuthAccessToken(bearerToken)
    if (!verified) return undefined
    return {
      token: bearerToken,
      clientId: verified.userId,
      scopes: verified.scopes.length ? verified.scopes : ALLOWED_SCOPES,
      extra: { userId: verified.userId, oauthTokenId: verified.tokenId },
    }
  },
  { required: true }
)

export { authHandler as GET, authHandler as POST, authHandler as DELETE }

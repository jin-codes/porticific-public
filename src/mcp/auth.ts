import { createAdminClient } from '@/lib/supabase/admin'
import { KEY_PREFIX, sha256Hex } from '@/lib/mcp-key'
import { parseScope, type KeyScope } from './scope'

export interface VerifiedKey {
  userId: string
  apiKeyId: string
  scope: KeyScope
}

export async function verifyApiKey(raw: string): Promise<VerifiedKey | null> {
  if (!raw.startsWith(KEY_PREFIX)) return null
  const db = createAdminClient()
  const { data } = await db
    .from('mcp_api_keys')
    .select('id, user_id, revoked_at, scope')
    .eq('key_hash', sha256Hex(raw))
    .maybeSingle()
  if (!data || data.revoked_at) return null

  await db.from('mcp_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id)
  return { userId: data.user_id, apiKeyId: data.id, scope: parseScope(data.scope) }
}

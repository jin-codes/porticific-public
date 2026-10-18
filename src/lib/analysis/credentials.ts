import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { Ctx } from '@/lib/portfolio/service'
import { decryptSecret, encryptSecret, secretBoxConfigured } from '@/lib/secret-box'
import { createAdminClient } from '@/lib/supabase/admin'

const isOwner = (ctx: Ctx) => !!process.env.OWNER_USER_ID && process.env.OWNER_USER_ID === ctx.userId

export const NO_KEY_REASON =
  'No Anthropic API key available. Add your own key in Settings, or ask your own Claude to do the analysis with analysis_context + save_analysis.'

export const BYOK_PREFIX = 'sk-ant-'

/**
 * Which Anthropic key pays for an analysis run:
 * 1. the user's own key (BYOK), if saved;
 * 2. otherwise the server key, but only for the operator account or when the caller is the weekly job
 *    (`serverKeyOk`). Everyone else must bring their own key, so no one else spends the operator's money.
 */
export async function resolveAnthropicKey(ctx: Ctx, opts: { serverKeyOk?: boolean } = {}): Promise<string | null> {
  if (secretBoxConfigured()) {
    const { data } = await createAdminClient().from('user_anthropic_keys').select('ciphertext').eq('user_id', ctx.userId).maybeSingle()
    if (data) {
      try {
        return decryptSecret(data.ciphertext)
      } catch {
        /* unreadable (secret rotated): treat as no own key */
      }
    }
  }
  if ((isOwner(ctx) || opts.serverKeyOk) && process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  return null
}

/** Check the key against the API (a free call) before storing it, then store it encrypted. */
export async function saveUserAnthropicKey(ctx: Ctx, rawKey: string): Promise<void> {
  const apiKey = rawKey.trim()
  if (!apiKey.startsWith(BYOK_PREFIX) || apiKey.length < 20 || apiKey.length > 300) throw new Error('Anthropic API 키 형식이 아닙니다 (sk-ant-…).')
  if (!secretBoxConfigured()) throw new Error('서버에 KEY_ENCRYPTION_SECRET이 설정되지 않아 키를 저장할 수 없습니다.')
  try {
    await new Anthropic({ apiKey }).models.list({ limit: 1 })
  } catch {
    throw new Error('Anthropic이 이 키를 거부했습니다. 키를 확인해 주세요.')
  }
  const { error } = await createAdminClient()
    .from('user_anthropic_keys')
    .upsert({ user_id: ctx.userId, ciphertext: encryptSecret(apiKey), key_hint: apiKey.slice(-4) }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}

export async function deleteUserAnthropicKey(ctx: Ctx): Promise<void> {
  const { error } = await createAdminClient().from('user_anthropic_keys').delete().eq('user_id', ctx.userId)
  if (error) throw new Error(error.message)
}

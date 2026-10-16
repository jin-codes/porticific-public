import 'server-only'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { makeCtx, type Ctx } from '@/lib/portfolio/service'

/** The signed-in user (verified by Supabase via the session cookie) or a redirect to /login. */
export async function requireUser(): Promise<{ userId: string; email: string }> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims?.sub) redirect('/login')
  return { userId: claims.sub, email: String(claims.email ?? '') }
}

export async function requireCtx(): Promise<Ctx & { email: string }> {
  const { userId, email } = await requireUser()
  return { ...makeCtx(userId), email }
}

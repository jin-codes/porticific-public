import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// service_role 키로 RLS를 우회하는 서버 전용 클라이언트.
// 클라이언트 컴포넌트에서 import하면 절대 안 됨 — 호출부(관리자 API route/서버 컴포넌트)에서
// 반드시 profiles.is_admin 확인 후에만 사용할 것.
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

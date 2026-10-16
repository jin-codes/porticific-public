'use client'

import { createClient } from '@/lib/supabase/client'

export default function LoginButton({ next }: { next?: string }) {
  async function signIn() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}` },
    })
  }

  return (
    <button
      onClick={signIn}
      className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-black/5"
    >
      Google로 계속하기
    </button>
  )
}

'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Same-site relative paths only: never navigate to another origin after sign-in.
const safeNext = (n?: string) => (n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/')

const field = 'w-full rounded-md border px-3 py-2 text-sm dark:bg-transparent'
const button = 'rounded-md border px-4 py-2 text-sm font-medium hover:bg-black/5 disabled:opacity-50'

export default function LoginButton({ next }: { next?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  const callback = () => `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`

  async function signInWithGoogle() {
    await createClient().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callback() } })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const auth = createClient().auth
    if (mode === 'signin') {
      const { error } = await auth.signInWithPassword({ email, password })
      if (error) setMessage({ text: '이메일 또는 비밀번호가 올바르지 않습니다.', error: true })
      else window.location.assign(safeNext(next))
    } else {
      const { data, error } = await auth.signUp({ email, password, options: { emailRedirectTo: callback() } })
      if (error) setMessage({ text: error.message, error: true })
      else if (data.session) window.location.assign(safeNext(next))
      else setMessage({ text: '확인 메일을 보냈습니다. 메일의 링크를 누르면 로그인됩니다.' })
    }
    setBusy(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <button onClick={signInWithGoogle} className={button}>
        Google로 계속하기
      </button>
      <div className="text-center text-xs text-neutral-500">또는 이메일로</div>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <input type="email" required autoComplete="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        <input
          type="password"
          required
          minLength={8}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          placeholder="비밀번호 (8자 이상)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
        />
        <button type="submit" disabled={busy} className={button}>
          {mode === 'signin' ? '이메일로 로그인' : '이메일로 가입'}
        </button>
      </form>
      {message && <p role={message.error ? 'alert' : 'status'} className={`text-sm ${message.error ? 'text-red-600' : 'text-neutral-600'}`}>{message.text}</p>}
      <button type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(null) }} className="text-xs text-neutral-500 underline">
        {mode === 'signin' ? '계정이 없나요? 이메일로 가입' : '이미 계정이 있나요? 로그인'}
      </button>
    </div>
  )
}

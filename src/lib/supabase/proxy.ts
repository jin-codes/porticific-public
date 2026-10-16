import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Refreshes the Supabase session cookie on every matched request and sends
// signed-out visitors to /login. Pages must still verify the user themselves
// (getClaims) — this is a convenience redirect, not the security boundary.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data } = await supabase.auth.getClaims()

  const path = request.nextUrl.pathname
  const isPublic = path.startsWith('/login') || path === '/ko' || path === '/en'
  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone()
    // Signed-out visitors on the bare domain get the landing page in their language.
    const ko = path === '/' && /^\s*ko/i.test(request.headers.get('accept-language') ?? '')
    url.pathname = path === '/' ? (ko ? '/ko' : '/en') : '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}

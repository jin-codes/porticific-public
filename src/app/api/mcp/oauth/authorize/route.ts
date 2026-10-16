import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sha256Hex } from '@/lib/mcp-key'
import { ALLOWED_SCOPES, generateAuthorizationCode, getOAuthClient, requestOrigin } from '@/mcp/oauth'

const CODE_TTL_MS = 10 * 60 * 1000

// The consent and error pages must never be framed by another site (clickjacking).
const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
}

// client_name is registered by anyone via DCR: untrusted, always escape before putting it in HTML.
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function page(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{font-family:system-ui,sans-serif;background:#fafafa;color:#171717;margin:0;padding:2rem 1rem}
  .card{max-width:30rem;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:1.75rem}
  h2{margin:0 0 .75rem;font-size:1.25rem}
  p{line-height:1.55;color:#404040}
  .box{background:#f5f5f5;border-radius:8px;padding:.75rem 1rem;margin:1rem 0;font-size:.9rem;word-break:break-all}
  .box b{display:block;font-size:.75rem;color:#737373;font-weight:600;margin-bottom:.15rem}
  ul{padding-left:1.1rem;color:#404040;line-height:1.6}
  .row{display:flex;gap:.6rem;margin-top:1.25rem}
  button{flex:1;padding:.7rem 1rem;border-radius:10px;border:1px solid #d4d4d4;background:#fff;font-size:.95rem;cursor:pointer}
  button.primary{background:#171717;border-color:#171717;color:#fff}
  .warn{color:#991b1b;font-size:.85rem}
</style></head><body><div class="card">${body}</div></body></html>`,
    { status, headers: HTML_HEADERS }
  )
}

const errorPage = (message: string) => page('porticific 연결 실패', `<h2>porticific 연결에 실패했습니다</h2><p>${esc(message)}</p>`, 400)

interface AuthorizeParams {
  responseType: string | null
  clientId: string | null
  redirectUri: string | null
  state: string | null
  codeChallenge: string | null
  codeChallengeMethod: string
  scope: string
}

function normalizeScope(raw: string | null): string {
  const requested = (raw ?? '').split(/\s+/).filter(Boolean)
  const granted = requested.filter((s) => ALLOWED_SCOPES.includes(s))
  return (granted.length ? granted : ALLOWED_SCOPES).join(' ')
}

function readParams(get: (key: string) => string | null): AuthorizeParams {
  return {
    responseType: get('response_type'),
    clientId: get('client_id'),
    redirectUri: get('redirect_uri'),
    state: get('state'),
    codeChallenge: get('code_challenge'),
    codeChallengeMethod: get('code_challenge_method') ?? 'S256',
    scope: normalizeScope(get('scope')),
  }
}

// Shared GET/POST validation: returns the registered client, or an error page.
async function validate(p: AuthorizeParams) {
  if (p.responseType !== 'code') return { error: errorPage('response_type은 code만 지원합니다.') }
  if (!p.clientId || !p.redirectUri || !p.codeChallenge) {
    return { error: errorPage('client_id, redirect_uri, code_challenge는 필수입니다.') }
  }
  if (p.codeChallengeMethod !== 'S256') return { error: errorPage('code_challenge_method은 S256만 지원합니다.') }
  const client = await getOAuthClient(p.clientId)
  if (!client || !client.redirect_uris.includes(p.redirectUri)) {
    return { error: errorPage('등록되지 않은 client_id 또는 redirect_uri입니다.') }
  }
  return { client }
}

// GET only renders the consent screen; a code is issued only when the user presses "허용" (POST).
// DCR is open, so anyone can register a client with their own redirect_uri; auto-issuing a code to a
// logged-in browser that merely opened a link would let that client steal tokens.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const params = readParams((k) => searchParams.get(k))

  const checked = await validate(params)
  if (checked.error) return checked.error
  const client = checked.client!

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    // After Google login the callback sends the user back here (relative `next` only).
    const loginUrl = new URL('/login', requestOrigin(req))
    loginUrl.searchParams.set('next', `/api/mcp/oauth/authorize?${searchParams.toString()}`)
    return NextResponse.redirect(loginUrl.toString(), 303)
  }

  let redirectHost = params.redirectUri!
  try {
    redirectHost = new URL(params.redirectUri!).host || params.redirectUri!
  } catch {
    /* display only: show the raw value if it doesn't parse */
  }

  const hidden = (name: string, value: string | null) =>
    value === null ? '' : `<input type="hidden" name="${name}" value="${esc(value)}">`

  return page(
    'porticific 연결 허용',
    `<h2>이 앱이 porticific에 접근하려고 합니다</h2>
     <div class="box"><b>앱 이름 (앱이 직접 밝힌 이름이며 검증되지 않았습니다)</b>${esc(client.client_name ?? '이름 없는 앱')}</div>
     <div class="box"><b>승인 후 이동할 주소</b>${esc(redirectHost)}</div>
     <p>허용하면 이 앱이 내 계정(<b>${esc(user.email ?? '')}</b>)의 포트폴리오에서 다음을 할 수 있습니다:</p>
     <ul>
       <li>보유 종목, 매수 thesis, 분석, 거래 내역 조회</li>
       <li>거래 기록, thesis·관심종목·태그·DCA 수정</li>
     </ul>
     <p class="warn">직접 연결하려던 앱이 아니라면 “거부”를 누르세요. 연결은 언제든 설정 화면에서 해제할 수 있습니다.</p>
     <form method="POST" action="/api/mcp/oauth/authorize">
       ${hidden('response_type', params.responseType)}
       ${hidden('client_id', params.clientId)}
       ${hidden('redirect_uri', params.redirectUri)}
       ${hidden('state', params.state)}
       ${hidden('code_challenge', params.codeChallenge)}
       ${hidden('code_challenge_method', params.codeChallengeMethod)}
       ${hidden('scope', params.scope)}
       <div class="row">
         <button type="submit" name="decision" value="deny">거부</button>
         <button type="submit" name="decision" value="approve" class="primary">허용</button>
       </div>
     </form>`
  )
}

// Consent form submit: same-origin only (CSRF), session re-checked, then the code is issued.
export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  if (!origin || origin !== requestOrigin(req)) return errorPage('허용되지 않은 요청입니다.')

  const form = await req.formData()
  const params = readParams((k) => {
    const v = form.get(k)
    return typeof v === 'string' ? v : null
  })

  const checked = await validate(params)
  if (checked.error) return checked.error

  const redirect = new URL(params.redirectUri!)

  if (form.get('decision') !== 'approve') {
    redirect.searchParams.set('error', 'access_denied')
    if (params.state) redirect.searchParams.set('state', params.state)
    return NextResponse.redirect(redirect.toString(), 303)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return errorPage('로그인 세션이 만료되었습니다. 다시 로그인한 뒤 연결을 시도해주세요.')

  const code = generateAuthorizationCode()
  const { error } = await createAdminClient().from('mcp_oauth_codes').insert({
    code_hash: sha256Hex(code),
    client_id: params.clientId!,
    user_id: user.id,
    redirect_uri: params.redirectUri!,
    code_challenge: params.codeChallenge!,
    code_challenge_method: params.codeChallengeMethod,
    scope: params.scope,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (error) return errorPage('인증 코드 발급 중 오류가 발생했습니다.')

  redirect.searchParams.set('code', code)
  if (params.state) redirect.searchParams.set('state', params.state)
  return NextResponse.redirect(redirect.toString(), 303) // 303: turn the POST into a GET redirect
}

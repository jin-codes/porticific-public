import Link from 'next/link'
import { requireUser } from '@/lib/auth'

const NAV = [
  ['/', '대시보드'],
  ['/watchlist', '관심종목'],
  ['/trades', '거래'],
  ['/settings', '설정'],
] as const

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { email } = await requireUser()
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4">
        <Link href="/" className="text-lg font-semibold">
          porticific
        </Link>
        <nav className="flex gap-4 text-sm text-neutral-600 dark:text-neutral-400">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="hover:text-black dark:hover:text-white">
              {label}
            </Link>
          ))}
        </nav>
        <form action="/auth/signout" method="post" className="ml-auto flex items-center gap-3 text-xs text-neutral-500">
          <span className="hidden sm:inline">{email}</span>
          <button className="underline-offset-2 hover:underline">로그아웃</button>
        </form>
      </header>
      <main className="space-y-6">{children}</main>
      <footer className="mt-12 text-xs text-neutral-500">
        porticific은 개인 투자 기록과 분석 노트를 정리하는 도구이며 투자 자문이 아닙니다. 시세는 지연되거나 부정확할 수 있습니다.
      </footer>
    </div>
  )
}

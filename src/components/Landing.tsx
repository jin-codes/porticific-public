import Link from 'next/link'

export type Lang = 'ko' | 'en'

const COPY = {
  ko: {
    other: { href: '/en', label: 'English' },
    cta: 'Google로 시작하기',
    hero: {
      title: '매수 이유를 기록하고, 매일 점검하는 포트폴리오 저널',
      sub: '보유 종목, 매수 논거, 일일 분석, 실시간 시세를 한곳에. 웹에서도, Claude 같은 MCP 클라이언트에서도 같은 데이터를 씁니다.',
    },
    featuresTitle: '주요 기능',
    features: [
      ['보유 종목과 거래 기록', '매수·매도를 원장에 남기면 평단, 평가손익, 실현손익, 현금 비중이 자동으로 계산됩니다.'],
      ['매수 논거 검증', '논거를 검증 가능한 주장으로 쪼개고, 유지·약화·훼손 상태를 이력과 함께 추적합니다.'],
      ['일일 분석', '종목별 신호와 포트폴리오 요약을 매일 정리하고, 내 투자 성향을 항상 반영합니다.'],
      ['관심종목과 일정', '관심종목을 모아 두고 실적 발표 같은 다가오는 이벤트를 확인합니다.'],
      ['정기 투자 추적', '정기 매수 계획을 등록하면 예상 체결을 계산해 기록과 맞춰 줍니다.'],
      ['이메일 알림', '중요한 변화는 요약 메일로 받아볼 수 있습니다.'],
    ],
    mcpTitle: 'Claude와 연결',
    mcpBody: 'MCP를 지원하는 AI 클라이언트에 연결하면 "내 포트폴리오 요약해줘", "이 종목 매수 논거 보여줘"처럼 대화로 조회하고 기록할 수 있습니다. 쓰기 작업은 요청했을 때만 실행됩니다.',
    bottomTitle: '지금 시작해 보세요',
    disclaimer: 'porticific은 개인 투자 기록과 분석 노트를 정리하는 도구이며 투자 자문이 아닙니다. 시세는 지연되거나 부정확할 수 있습니다.',
  },
  en: {
    other: { href: '/ko', label: '한국어' },
    cta: 'Continue with Google',
    hero: {
      title: 'A portfolio journal that remembers why you bought',
      sub: 'Holdings, buy theses, daily analysis and live prices in one place. Use the same data from the web or from MCP clients like Claude.',
    },
    featuresTitle: 'What it does',
    features: [
      ['Holdings and trade ledger', 'Record buys and sells; average cost, unrealized and realized P&L and cash weight are computed for you.'],
      ['Thesis validation', 'Break a thesis into falsifiable claims and track intact / weakened / broken status with history.'],
      ['Daily analysis', 'A per-stock signal and portfolio summary each day, always shaped by your own investment profile.'],
      ['Watchlist and events', 'Keep a watchlist and see upcoming events such as earnings dates.'],
      ['Recurring buys', 'Register a DCA plan and the expected fills are estimated and reconciled with your records.'],
      ['Email alerts', 'Get important changes in a digest email.'],
    ],
    mcpTitle: 'Works with Claude',
    mcpBody: 'Connect any MCP-capable AI client and ask things like "summarize my portfolio" or "show the thesis for this stock". Write actions only run when you ask for them.',
    bottomTitle: 'Get started',
    disclaimer: 'porticific is a tool for keeping personal investment records and analysis notes. It is not investment advice. Prices may be delayed or inaccurate.',
  },
} as const

export default function Landing({ lang }: { lang: Lang }) {
  const t = COPY[lang]
  const button =
    'inline-block rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200'
  return (
    <div className="mx-auto max-w-4xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <span className="text-lg font-semibold">porticific</span>
        <nav className="flex items-center gap-4 text-sm">
          <Link href={t.other.href} hrefLang={t.other.href.slice(1)} className="text-neutral-500 hover:text-black dark:hover:text-white">
            {t.other.label}
          </Link>
          <Link href="/login" className="font-medium underline-offset-2 hover:underline">
            {lang === 'ko' ? '로그인' : 'Sign in'}
          </Link>
        </nav>
      </header>

      <main>
        <section className="py-16 sm:py-24">
          <h1 className="max-w-2xl text-3xl font-semibold leading-tight sm:text-5xl">{t.hero.title}</h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-neutral-600 dark:text-neutral-400">{t.hero.sub}</p>
          <div className="mt-8">
            <Link href="/login" className={button}>{t.cta}</Link>
          </div>
        </section>

        <section className="py-8">
          <h2 className="text-xl font-semibold">{t.featuresTitle}</h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {t.features.map(([title, body]) => (
              <li key={title} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                <h3 className="font-medium">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="py-8">
          <h2 className="text-xl font-semibold">{t.mcpTitle}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">{t.mcpBody}</p>
        </section>

        <section className="py-12 text-center">
          <h2 className="text-xl font-semibold">{t.bottomTitle}</h2>
          <div className="mt-5">
            <Link href="/login" className={button}>{t.cta}</Link>
          </div>
        </section>
      </main>

      <footer className="mt-8 text-xs text-neutral-500">{t.disclaimer}</footer>
    </div>
  )
}

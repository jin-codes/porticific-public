import type { Metadata } from 'next'
import Landing from '@/components/Landing'

export const metadata: Metadata = {
  title: 'porticific — 매수 논거를 기록하는 포트폴리오 저널',
  description: '보유 종목, 매수 논거, 일일 분석, 실시간 시세를 한곳에. 웹과 Claude(MCP)에서 함께 쓰는 포트폴리오 저널.',
  alternates: { canonical: '/ko', languages: { ko: '/ko', en: '/en', 'x-default': '/en' } },
}

export default function KoLanding() {
  return <Landing lang="ko" />
}

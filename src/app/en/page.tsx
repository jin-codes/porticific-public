import type { Metadata } from 'next'
import Landing from '@/components/Landing'

export const metadata: Metadata = {
  title: 'porticific — a portfolio journal that remembers why you bought',
  description: 'Holdings, buy theses, daily analysis and live prices in one place. A portfolio journal for the web and for Claude (MCP).',
  alternates: { canonical: '/en', languages: { ko: '/ko', en: '/en', 'x-default': '/en' } },
}

export default function EnLanding() {
  return <Landing lang="en" />
}

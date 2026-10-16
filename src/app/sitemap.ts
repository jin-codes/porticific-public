import type { MetadataRoute } from 'next'

const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
const languages = { ko: `${base}/ko`, en: `${base}/en` }

// Only public pages: everything else sits behind login.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${base}/en`, changeFrequency: 'monthly', priority: 1, alternates: { languages } },
    { url: `${base}/ko`, changeFrequency: 'monthly', priority: 1, alternates: { languages } },
  ]
}

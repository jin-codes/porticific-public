import type { MetadataRoute } from 'next'

const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: ['/en', '/ko', '/login'], disallow: ['/api/', '/auth/'] },
    sitemap: `${base}/sitemap.xml`,
  }
}

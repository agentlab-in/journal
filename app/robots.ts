import type { MetadataRoute } from 'next'
import { SITE_URL, absoluteUrl } from '@/lib/site-url'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/write', '/settings', '/api', '/auth/blocked', '/auth/signin'],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
    host: SITE_URL,
  }
}

import type { MetadataRoute } from 'next'
import { SITE_URL, absoluteUrl } from '@/lib/site-url'

// H8 — Do not advertise sensitive paths in robots.txt. The admin/write/
// settings/auth surfaces are already protected at the handler
// (requireAdmin → notFound()), so listing them here just hands attackers
// a map of where to probe. Crawlers do not index 404s, so the
// misdirection holds without help from robots.
//
// L4 — On non-production deployments (Vercel previews, branch deploys)
// disallow everything so dev.agentlab.in and *-vercel.app URLs don't
// leak into Google.
export default function robots(): MetadataRoute.Robots {
  const isProduction = process.env.VERCEL_ENV === 'production'

  if (!isProduction) {
    return {
      rules: {
        userAgent: '*',
        disallow: '/',
      },
      host: SITE_URL,
    }
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/'],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
    host: SITE_URL,
  }
}

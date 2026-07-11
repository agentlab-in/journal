import type { NextConfig } from 'next'

// The Supabase Storage host is read from `NEXT_PUBLIC_SUPABASE_URL` at
// build time so we don't have to keep `next.config.ts` in sync with the
// project URL across local/preview/prod. If the env var is missing or
// malformed we silently omit the pattern — only the cover-image and
// avatar paths under /storage/v1/object/public/** would 404 from
// next/image, which is correct fail-loud behaviour.
const supabaseHostname = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
})()

// Phase 14 / C4 / F13: baseline security response headers.
//
// CSP is intentionally shipped in Report-Only mode: the operator watches
// reports before flipping to enforcement, so a stray inline script can't
// 500 the site mid-launch. Everything else is enforced immediately because
// the failure mode is benign (no rendering behaviour depends on these
// absent headers).
//
// F13 reporting: set CSP_REPORT_URI to a hosted collector's ingest URL
// (report-uri.com / URIports, configured to email harshit@agentlab.in) to
// receive violation reports. When it is unset, no reporting directives are
// emitted, so nothing ships until the operator wires a collector. This stays
// Report-Only; flipping to enforcing is a separate change made only after a
// clean week of reports plus a manual prod page-walk.
const CSP_REPORT_URI = process.env.CSP_REPORT_URI ?? ''

const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://api.github.com https://*.upstash.io",
  "frame-src 'self' https://www.youtube.com https://platform.twitter.com https://gist.github.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  'upgrade-insecure-requests',
  // Reporting directives, emitted only when a collector URL is configured.
  // report-uri is the widely-supported legacy form; report-to targets the
  // Reporting API group declared in the Reporting-Endpoints header below.
  ...(CSP_REPORT_URI
    ? [`report-uri ${CSP_REPORT_URI}`, 'report-to csp-endpoint']
    : []),
].join('; ')

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
  // Reporting API endpoint group referenced by the CSP report-to directive.
  // Only present when a collector URL is configured.
  ...(CSP_REPORT_URI
    ? [{ key: 'Reporting-Endpoints', value: `csp-endpoint="${CSP_REPORT_URI}"` }]
    : []),
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'X-Frame-Options', value: 'DENY' },
]

const nextConfig: NextConfig = {
  // L3 — strip the `X-Powered-By: Next.js` banner.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ]
  },
  // Phase 3 legal consolidation: every other legal URL now redirects to
  // the single combined /terms page.
  async redirects() {
    return [
      { source: '/privacy', destination: '/terms', permanent: true },
      { source: '/policy', destination: '/terms', permanent: true },
      { source: '/grievance', destination: '/terms', permanent: true },
      { source: '/dmca', destination: '/terms', permanent: true },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
        pathname: '/u/**',
      },
      ...(supabaseHostname
        ? [
            {
              protocol: 'https' as const,
              hostname: supabaseHostname,
              // Restrict to the public-bucket prefix — service-role
              // signed URLs are never rendered as <Image>.
              pathname: '/storage/v1/object/public/**',
            },
          ]
        : []),
    ],
  },
  experimental: {
    // Phase 13 a11y: enables app/global-not-found.tsx so any notFound()
    // raised outside the root layout (e.g. from an async server component
    // before the layout finishes hydrating) still emits a full document
    // with <html lang="en">. Without this Next 16 emits an
    // <html id="__next_error__"> fragment that fails WCAG 3.1.1.
    globalNotFound: true,
  },
}

export default nextConfig

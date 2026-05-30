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

const nextConfig: NextConfig = {
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

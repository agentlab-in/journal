import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
        pathname: '/u/**',
      },
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

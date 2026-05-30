import Link from 'next/link'
import './globals.css'
import { THEME_INIT_SCRIPT } from '@/lib/theme/init-script'

/**
 * global-not-found.tsx
 *
 * Next.js 16 experimental: a 404 page that lives outside the route tree.
 * It owns the entire <html>/<body> so a notFound() raised before the root
 * layout finishes rendering (e.g. from an async server component) still
 * emits a fully-formed document, including `<html lang="en">`. Without
 * this, axe flags the dev-mode `__next_error__` HTML as missing the lang
 * attribute (WCAG 3.1.1).
 *
 * Enabled via `experimental.globalNotFound: true` in next.config.ts.
 *
 * This is INTENTIONALLY a simpler render than `app/not-found.tsx`: no
 * Nav, no Footer, no theme toggle — because we can't rely on the
 * AuthProvider / Nav infrastructure being available when the root layout
 * didn't run.
 */
export const metadata = {
  title: 'Page not found — agentlab.in',
  description: 'The page you are looking for does not exist.',
}

export default function GlobalNotFound() {
  return (
    // suppressHydrationWarning mirrors app/layout.tsx — the pre-hydration
    // theme script below sets `data-theme` on <html> before React mounts,
    // so the server (no data-theme) vs client (data-theme="light"|"dark")
    // mismatch is intentional and would otherwise spam the console.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Must run before paint to avoid a light-theme flash on 404
            for returning dark-mode users. Mirrors app/layout.tsx. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col bg-bg text-fg">
        <main id="main-content" className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
          <p className="font-mono text-sm text-fg-subtle">404</p>
          <h1 className="mt-2 font-mono text-2xl font-black lowercase tracking-tight text-fg">
            page not found
          </h1>
          <p className="mt-3 text-sm text-fg-subtle">
            This page doesn&apos;t exist yet.
          </p>
          <Link
            href="/"
            className="mt-6 text-sm text-fg underline underline-offset-4 hover:opacity-70"
          >
            back to agentlab
          </Link>
        </main>
      </body>
    </html>
  )
}

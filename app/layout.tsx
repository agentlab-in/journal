import type { Metadata } from 'next'
import { JetBrains_Mono } from 'next/font/google'
import './globals.css'
import Nav from '@/components/layout/Nav'
import Footer from '@/components/layout/Footer'
import AuthProvider from '@/components/providers/AuthProvider'

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  display: 'swap',
})

const SITE_DESCRIPTION = 'Community publishing for AI agent infrastructure.'

export const metadata: Metadata = {
  metadataBase: new URL('https://agentlab.in'),
  // Phase 13 title format: `{page label} — agentlab.in` everywhere
  // EXCEPT the home page (which uses `title.absolute: 'agentlab.in'`
  // to bypass the template — the site name alone is the title there).
  //
  // Em-dash (U+2014) with one space on each side. Routes that need
  // a multi-level hierarchy (admin sub-pages, dynamic post / profile
  // pages) override via `title.absolute` to build their own string
  // and avoid double-dash chains like "Tags — Admin — agentlab.in".
  title: {
    template: '%s — agentlab.in',
    default: 'agentlab.in',
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    title: 'agentlab.in',
    description: SITE_DESCRIPTION,
    siteName: 'agentlab.in',
    images: ['/og.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'agentlab.in',
    description: SITE_DESCRIPTION,
    images: ['/og.png'],
  },
}

// Pre-hydration theme script — runs synchronously in <head> before React
// mounts so the correct `data-theme` lands on <html> on the very first
// paint. Without it, a returning dark-mode user briefly flashes the
// system/default theme (FOUC) until <ThemeToggle> re-reads localStorage.
// Phase 13: localStorage key is `theme` (kept short so it reads cleanly
// in devtools and isn't tied to the app's marketing name).
const THEME_INIT_SCRIPT = `(function(){
  try {
    var t = localStorage.getItem('theme');
    if (t !== 'light' && t !== 'dark') {
      t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={jetbrainsMono.variable}
      // The pre-hydration script below sets data-theme on <html> before
      // React mounts. Without suppressHydrationWarning, React would flag
      // the server (no data-theme) vs. client (data-theme="light"|"dark")
      // mismatch on every page load. The mismatch is intentional and the
      // attribute change is invisible to the React tree.
      suppressHydrationWarning
    >
      <head>
        {/* Must run before paint to avoid theme flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col">
        {/* Skip-to-content link: invisible until keyboard focus, then
            pinned to the top-left so a sighted keyboard user can jump
            past the nav. WCAG 2.4.1 (Bypass Blocks). */}
        <a href="#main-content" className="skip-to-content">
          Skip to content
        </a>
        <AuthProvider>
          <Nav />
          {/* Pages render their own <main> so there's exactly one main
              landmark per route (axe: landmark-no-duplicate-main).
              This wrapper is just a flex container. */}
          <div className="flex flex-1 flex-col">{children}</div>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  )
}

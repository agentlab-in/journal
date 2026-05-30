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
  title: 'agentlab',
  description: SITE_DESCRIPTION,
  openGraph: {
    title: 'agentlab',
    description: SITE_DESCRIPTION,
    siteName: 'agentlab.in',
    images: ['/og.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'agentlab',
    description: SITE_DESCRIPTION,
    images: ['/og.png'],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={jetbrainsMono.variable}>
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

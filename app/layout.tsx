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
        <AuthProvider>
          <Nav />
          <main className="flex flex-1 flex-col">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  )
}

'use client'

import { SessionProvider } from 'next-auth/react'

/**
 * Thin client wrapper that provides the NextAuth session context
 * to the entire component tree.
 *
 * Placed in app/layout.tsx (server component) by passing children through.
 */
export default function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>
}

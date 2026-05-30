import type { Metadata } from 'next'

// SignIn page is a client component, so it can't export `metadata` directly.
// This layout exists solely to attach metadata for that one route.
// Title resolves to `Sign in — agentlab.in` via the root layout template.
export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false },
}

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children
}

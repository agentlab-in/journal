import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Consent declined',
  robots: { index: false, follow: false },
}

export default function ConsentDeclinedPage() {
  return (
    <main id="main-content" className="settings-page">
      <h1 className="settings-heading">You can&rsquo;t use agentlab.in without agreeing</h1>
      <p className="settings-help">
        We require explicit consent to our{' '}
        <Link href="/terms">Terms of Service</Link>,{' '}
        <Link href="/policy">Content Policy</Link>, and{' '}
        <Link href="/privacy">Privacy Policy</Link> — and confirmation that you
        are 18 or older — before any account can be created. Your in-progress
        signup has been cancelled and no account data was saved.
      </p>
      <p className="settings-help">
        If you change your mind,{' '}
        <Link href="/auth/signin">sign in again</Link> and complete the consent step.
      </p>
    </main>
  )
}

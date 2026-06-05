import type { Metadata } from 'next'

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
        <a href="/terms">Terms of Service</a>,{' '}
        <a href="/policy">Content Policy</a>, and{' '}
        <a href="/privacy">Privacy Policy</a> — and confirmation that you
        are 18 or older — before any account can be created. Your in-progress
        signup has been cancelled and no account data was saved.
      </p>
      <p className="settings-help">
        If you change your mind,{' '}
        <a href="/auth/signin">sign in again</a> and complete the consent step.
      </p>
    </main>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Request access',
  robots: { index: false, follow: false },
}

/**
 * Static "how to get in" page. agentlab is invite-only: reading is open to
 * everyone, publishing is approved by hand out-of-band. No DB, no counter
 * infra; the "~200 days" line is a deliberate static joke.
 */
export default function ApplyPage() {
  return (
    <main
      id="main-content"
      className="flex flex-1 flex-col items-center justify-center px-6 py-24"
    >
      <div className="w-full max-w-md space-y-5 text-center text-sm leading-relaxed">
        <h1 className="font-mono text-2xl font-black lowercase tracking-tight text-fg">
          agentlab is invite-only
        </h1>
        <p className="text-fg-subtle">
          Anyone can read agentlab. Publishing is approved by hand. To ask for
          access, email{' '}
          <a
            href="mailto:harshit@agentlab.in"
            className="text-fg underline underline-offset-2"
          >
            harshit@agentlab.in
          </a>{' '}
          and explain why you should be allowed to post.
        </p>
        <p className="text-fg-subtle">
          Average review time: <strong className="text-fg">~200 days</strong>.
          That is mostly a joke. Mostly.
        </p>
        <p className="text-fg-subtle">
          If you are approved, reply{' '}
          <em>&ldquo;I agree to the terms at agentlab.in/terms&rdquo;</em> and you
          will be added. The{' '}
          <Link href="/terms" className="text-fg underline underline-offset-2">
            terms
          </Link>{' '}
          are worth reading first.
        </p>
        <p className="pt-2">
          <Link
            href="/auth/signin"
            className="font-mono text-xs text-fg-subtle hover:text-fg"
          >
            Already approved? Sign in →
          </Link>
        </p>
      </div>
    </main>
  )
}

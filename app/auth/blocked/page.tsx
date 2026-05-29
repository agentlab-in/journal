import Link from 'next/link'

/**
 * Blocked page — shown when the sign-up gate rejects a GitHub account.
 *
 * `searchParams` is async in Next.js 15+ (including Next 16).
 * The `reason` param comes from the redirect URL set in the signIn callback.
 *
 * Reason formats:
 *   age_<N>_days           — account is N days old (< 30)
 *   no_public_repos        — account has 0 public repos
 *   reserved_name          — GitHub login collides with a reserved platform name
 *   invalid_account_data   — GitHub /user returned a malformed timestamp
 */

interface PageProps {
  searchParams: Promise<{ reason?: string; login?: string }>
}

// GitHub handle shape: 1-39 chars, alphanumeric + hyphen.
// We sanitise so a hostile redirect can't smuggle "<script>" or other
// arbitrary strings into the page (React already escapes, but rejecting
// outright keeps the UI clean and matches the same shape evaluateGate
// uses when building the redirect URL).
const GH_LOGIN_RE = /^[a-z0-9-]{1,39}$/i

function sanitiseLogin(raw: string | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  return GH_LOGIN_RE.test(raw) ? raw.toLowerCase() : null
}

function parseReason(reason: string | undefined): React.ReactNode {
  if (!reason) {
    return <p className="text-fg-subtle">Your account does not meet the eligibility criteria.</p>
  }

  // age_<N>_days
  const ageMatch = reason.match(/^age_(\d+)_days$/)
  if (ageMatch) {
    const ageDays = parseInt(ageMatch[1], 10)
    const daysLeft = 30 - ageDays

    // Compute the eligible date: today + daysLeft
    const eligible = new Date()
    eligible.setDate(eligible.getDate() + daysLeft)
    const eligibleStr = eligible.toLocaleDateString('en-CA') // YYYY-MM-DD

    return (
      <p className="text-fg-subtle">
        Your GitHub account is only <strong className="text-fg">{ageDays} day{ageDays !== 1 ? 's' : ''}</strong> old.
        Accounts must be at least 30 days old to join agentlab.
        <br />
        Come back on <strong className="text-fg">{eligibleStr}</strong>.
      </p>
    )
  }

  if (reason === 'no_public_repos') {
    return (
      <p className="text-fg-subtle">
        Your GitHub account has no public repositories.
        You need at least 1 public repo to join agentlab.
      </p>
    )
  }

  if (reason === 'invalid_account_data') {
    return (
      <p className="text-fg-subtle">
        We couldn&rsquo;t read your GitHub account details. Try signing in again,
        or contact{' '}
        <a
          href="mailto:harshit@agentlab.in"
          className="text-fg underline underline-offset-2 hover:opacity-80"
        >
          harshit@agentlab.in
        </a>{' '}
        if this keeps happening.
      </p>
    )
  }

  if (reason === 'reserved_name') {
    return (
      <p className="text-fg-subtle">
        That username is reserved by the platform.
        If you believe this is a mistake, contact{' '}
        <a
          href="mailto:harshit@agentlab.in"
          className="text-fg underline underline-offset-2 hover:opacity-80"
        >
          harshit@agentlab.in
        </a>
        .
      </p>
    )
  }

  return <p className="text-fg-subtle">Your account does not meet the eligibility criteria.</p>
}

export default async function BlockedPage({ searchParams }: PageProps) {
  const { reason, login } = await searchParams
  const safeLogin = sanitiseLogin(login)

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="font-mono text-2xl font-black lowercase tracking-tight text-fg">
          sign-up blocked
        </h1>

        {safeLogin && (
          <p className="font-mono text-xs uppercase tracking-wide text-fg-subtle">
            sign-up blocked for <span className="text-fg">@{safeLogin}</span>
          </p>
        )}

        <div className="text-sm leading-relaxed">{parseReason(reason)}</div>

        <Link
          href="/"
          className="inline-block font-mono text-sm text-fg-subtle hover:text-fg"
        >
          ← Back home
        </Link>
      </div>
    </div>
  )
}

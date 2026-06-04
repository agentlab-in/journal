/**
 * Phase 14 — Origin allowlist for CSRF defence on mutating routes.
 *
 * The allowlist is the set of deployment origins (production, dev, local).
 * Origins are NOT secrets — they are the public hostnames the browser is
 * allowed to send authenticated POST/PATCH/DELETE requests from.
 *
 * Trailing slashes are tolerated (some callers pass `Origin` headers with
 * them). Scheme and host are case-sensitive — browsers normalise both, so
 * we do not need to.
 *
 * L8 — `http://localhost:3010` is only allowed outside production builds
 * so a hostile network can't try to fabricate an Origin header that
 * matches the local dev port against the prod deployment.
 */
const ALWAYS_ALLOWED_ORIGINS: ReadonlyArray<string> = [
  'https://agentlab.in',
  'https://dev.agentlab.in',
]

const DEV_ONLY_ORIGINS: ReadonlyArray<string> = ['http://localhost:3010']

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set(
  process.env.NODE_ENV === 'production'
    ? ALWAYS_ALLOWED_ORIGINS
    : [...ALWAYS_ALLOWED_ORIGINS, ...DEV_ONLY_ORIGINS],
)

export function isAllowedOrigin(origin: string | null): boolean {
  if (origin === null) return false
  if (origin === '') return false
  // Tolerate a single trailing slash; reject anything beyond the origin.
  const normalised = origin.endsWith('/') ? origin.slice(0, -1) : origin
  return ALLOWED_ORIGINS.has(normalised)
}

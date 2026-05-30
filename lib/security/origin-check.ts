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
 */
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  'https://agentlab.in',
  'https://dev.agentlab.in',
  'http://localhost:3010',
])

export function isAllowedOrigin(origin: string | null): boolean {
  if (origin === null) return false
  if (origin === '') return false
  // Tolerate a single trailing slash; reject anything beyond the origin.
  const normalised = origin.endsWith('/') ? origin.slice(0, -1) : origin
  return ALLOWED_ORIGINS.has(normalised)
}

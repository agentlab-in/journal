/**
 * Phase 14 — Parse the retry hint from a 429 response.
 *
 * Prefers the JSON body's `retry_after` (set by lib/route-guard) and falls
 * back to the standard `Retry-After` header. Returns a sane default if
 * neither is parseable so the UI always has something to render.
 *
 * Implementation notes:
 *   - `.clone()` the response before reading the body so the caller can
 *     still consume `res.json()` / `res.text()` after this helper returns.
 *   - We require `retry_after > 0` (strictly positive) rather than `>= 0`:
 *     a zero hint would render as "try again in 0s", which is worse UX than
 *     just falling through to the default. Same rule applies to the header.
 *   - Default of 30s matches the default route-guard window — generous
 *     enough that the user won't immediately re-hit the limit.
 */
const DEFAULT_RETRY_SECONDS = 30

export async function readRetryAfter(res: Response): Promise<number> {
  try {
    const cloned = res.clone()
    const body = (await cloned.json()) as { retry_after?: number }
    if (
      typeof body.retry_after === 'number' &&
      Number.isFinite(body.retry_after) &&
      body.retry_after > 0
    ) {
      return Math.ceil(body.retry_after)
    }
  } catch {
    // body wasn't JSON or had no retry_after — fall through
  }
  const header = res.headers.get('Retry-After')
  if (header) {
    const n = Number(header)
    if (Number.isFinite(n) && n > 0) return Math.ceil(n)
  }
  return DEFAULT_RETRY_SECONDS
}

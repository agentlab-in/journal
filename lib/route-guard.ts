/**
 * Phase 14 — Mutating-route guard.
 *
 * Single helper applied at the top of every mutating API handler so the
 * origin-allowlist + rate-limit gates are enforced uniformly. Returns a
 * `failed` discriminator instead of throwing so each handler can short-
 * circuit with the pre-built Response without losing its own auth flow
 * (auth checks should run BEFORE this guard so unauth still returns 401).
 */
import { checkRateLimit, type RateLimitBucket } from '@/lib/rate-limit'
import { isAllowedOrigin } from '@/lib/security/origin-check'

export interface GuardOptions {
  /** Bucket to charge. If undefined, skip rate-limit check. */
  bucket?: RateLimitBucket
  /** User id for rate-limit identifier. If undefined, skip rate-limit check. */
  userId?: string | null
  /** Skip the origin check for this call. Default false (origin required). */
  skipOrigin?: boolean
}

export interface GuardFailure {
  failed: true
  response: Response
}

export interface GuardOk {
  failed: false
}

export type GuardResult = GuardOk | GuardFailure

function json(status: number, body: Record<string, unknown>, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

export async function guardMutatingRequest(
  req: Request,
  opts: GuardOptions,
): Promise<GuardResult> {
  // Origin check first — cheaper than a Redis round-trip and a missing
  // Origin header is the canonical CSRF signal.
  if (!opts.skipOrigin) {
    const origin = req.headers.get('origin')
    if (!isAllowedOrigin(origin)) {
      return {
        failed: true,
        response: json(403, { error: 'forbidden_origin' }),
      }
    }
  }

  // Rate limit only when both a bucket AND a user id are present.
  // An anonymous mutating route (none exist in v1, but the API supports
  // it) gets origin-only protection — IP-based limits would belong in
  // edge middleware, not here.
  if (opts.bucket && opts.userId) {
    // `checkRateLimit` already handles Upstash failures internally (timeout
    // + fail-open/closed policy). The belt-and-braces try/catch here is so
    // a future code change inside `checkRateLimit` — or an unexpected
    // synchronous throw — cannot 500 every mutation handler. We log and
    // proceed; the in-module warn covers the diagnostic story.
    let result
    try {
      result = await checkRateLimit(opts.bucket, `user:${opts.userId}`)
    } catch (err) {
      console.warn(
        `[route-guard] checkRateLimit threw unexpectedly: ${err instanceof Error ? err.message : 'unknown'}`,
      )
      return { failed: false }
    }
    if (!result.success) {
      return {
        failed: true,
        response: json(
          429,
          { error: 'rate_limited', retry_after: result.retryAfter },
          { 'Retry-After': String(result.retryAfter) },
        ),
      }
    }
  }

  return { failed: false }
}

/**
 * Phase 14 — Rate limiting.
 *
 * Uses Upstash Redis (REST) for production, with an in-memory sliding-window
 * fallback when Upstash env vars are not configured or NODE_ENV === 'test'.
 *
 * The in-memory fallback is single-region and not authoritative — it exists
 * so that local dev and CI work without external secrets. Production deploys
 * should set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
 */
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { env } from '@/lib/env'

export type RateLimitBucket =
  | 'publish'
  | 'edit_post'
  | 'delete_post'
  | 'comment'
  | 'engagement'
  | 'report'
  | 'image_upload'
  | 'delete_account'
  | 'mdx_preview'
  | 'view_count'
  | 'create_org'
  | 'edit_org'
  | 'delete_org'
  | 'edit_org_members'

export interface RateLimitResult {
  success: boolean
  remaining: number
  /** Unix seconds at which the next slot becomes available (sliding window). */
  reset: number
  /** Seconds to wait before retrying; 0 when success === true. */
  retryAfter: number
}

interface BucketSpec {
  /** Maximum requests per window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
  /** Window length expressed as a duration string for @upstash/ratelimit. */
  windowDuration: Parameters<typeof Ratelimit.slidingWindow>[1]
}

const BUCKETS: Record<RateLimitBucket, BucketSpec> = {
  publish: { limit: 10, windowMs: 60 * 60 * 1000, windowDuration: '1 h' },
  edit_post: { limit: 30, windowMs: 60 * 60 * 1000, windowDuration: '1 h' },
  delete_post: { limit: 30, windowMs: 60 * 60 * 1000, windowDuration: '1 h' },
  comment: { limit: 30, windowMs: 10 * 60 * 1000, windowDuration: '10 m' },
  engagement: { limit: 60, windowMs: 60 * 1000, windowDuration: '1 m' },
  report: { limit: 10, windowMs: 60 * 60 * 1000, windowDuration: '1 h' },
  image_upload: { limit: 20, windowMs: 60 * 60 * 1000, windowDuration: '1 h' },
  // Self-service account deletion is irreversible; a low cap defends against
  // an authed caller spamming the endpoint without the legitimate use case
  // (one delete per account) ever hitting the ceiling.
  delete_account: { limit: 3, windowMs: 60 * 60 * 1000, windowDuration: '1 h' },
  // Editor preview compiles on every keystroke (debounced 300ms), so the
  // ceiling is generous — defends against a script hammering the endpoint
  // without throttling honest authors.
  mdx_preview: { limit: 60, windowMs: 60 * 1000, windowDuration: '1 m' },
  // Anonymous view beacon. Keyed by IP (not user) at the call site since
  // the route is unauth. 60/min lets normal browsing through; a script
  // forging Origin and pumping increments gets shut down.
  view_count: { limit: 60, windowMs: 60 * 1000, windowDuration: '1 m' },
  create_org: {
    limit: 3,
    windowMs: 7 * 24 * 60 * 60 * 1000,
    windowDuration: '7 d',
  },
  edit_org: { limit: 30, windowMs: 60 * 60 * 1000, windowDuration: '1 h' },
  delete_org: { limit: 30, windowMs: 60 * 60 * 1000, windowDuration: '1 h' },
  edit_org_members: {
    limit: 30,
    windowMs: 60 * 60 * 1000,
    windowDuration: '1 h',
  },
}

// ---------------------------------------------------------------------------
// In-memory fallback (sliding window)
// ---------------------------------------------------------------------------

interface MemoryEntry {
  /** Sorted ascending request timestamps (ms). */
  timestamps: number[]
}

const memoryStore = new Map<string, MemoryEntry>()
let warnedAboutFallback = false

function memoryKey(bucket: RateLimitBucket, identifier: string): string {
  return `${bucket}::${identifier}`
}

function checkMemory(
  bucket: RateLimitBucket,
  identifier: string,
  spec: BucketSpec,
): RateLimitResult {
  const now = Date.now()
  const windowStart = now - spec.windowMs
  const key = memoryKey(bucket, identifier)

  const entry = memoryStore.get(key) ?? { timestamps: [] }
  // Drop timestamps outside the window.
  const trimmed = entry.timestamps.filter((t) => t > windowStart)

  if (trimmed.length >= spec.limit) {
    // Rejected — do NOT record this attempt; reset is when the oldest in-window
    // request rolls out.
    memoryStore.set(key, { timestamps: trimmed })
    const oldest = trimmed[0]
    const resetMs = oldest + spec.windowMs
    return {
      success: false,
      remaining: 0,
      reset: Math.ceil(resetMs / 1000),
      retryAfter: Math.max(0, Math.ceil((resetMs - now) / 1000)),
    }
  }

  trimmed.push(now)
  memoryStore.set(key, { timestamps: trimmed })

  const oldest = trimmed[0]
  const resetMs = oldest + spec.windowMs
  return {
    success: true,
    remaining: spec.limit - trimmed.length,
    reset: Math.ceil(resetMs / 1000),
    retryAfter: 0,
  }
}

// ---------------------------------------------------------------------------
// Upstash branch
// ---------------------------------------------------------------------------

let cachedRedis: Redis | null = null
const upstashLimiters = new Map<RateLimitBucket, Ratelimit>()

function getRedis(): Redis {
  if (cachedRedis) return cachedRedis
  const url = env.UPSTASH_REDIS_REST_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    throw new Error(
      '[rate-limit] getRedis called without Upstash env vars set',
    )
  }
  cachedRedis = new Redis({ url, token })
  return cachedRedis
}

function getUpstashLimiter(bucket: RateLimitBucket): Ratelimit {
  const cached = upstashLimiters.get(bucket)
  if (cached) return cached
  const spec = BUCKETS[bucket]
  const limiter = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(spec.limit, spec.windowDuration),
    prefix: `rl:${bucket}`,
    analytics: false,
  })
  upstashLimiters.set(bucket, limiter)
  return limiter
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Evaluated once at import time. `env` is frozen at module load
// (`lib/env.ts` parses `process.env` at top level), so re-checking per call
// is misleading and just adds noise.
const USE_FALLBACK =
  process.env.NODE_ENV === 'test' ||
  !env.UPSTASH_REDIS_REST_URL ||
  !env.UPSTASH_REDIS_REST_TOKEN

// Fail-open by default: if Upstash is unreachable, allow the request
// rather than 500-ing every mutation. Set RATE_LIMIT_FAIL_OPEN=false to
// hard-fail (closed) on Upstash errors — useful for high-risk endpoints
// during an incident.
const FAIL_OPEN = process.env.RATE_LIMIT_FAIL_OPEN !== 'false'

const UPSTASH_TIMEOUT_MS = 1000

let warnedAboutUpstashFailure = false

/** Race a promise against a setTimeout reject. Used to cap Upstash calls. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('upstash_timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

export async function checkRateLimit(
  bucket: RateLimitBucket,
  identifier: string,
): Promise<RateLimitResult> {
  const spec = BUCKETS[bucket]
  if (!spec) {
    throw new Error(`[rate-limit] Unknown bucket: ${bucket}`)
  }

  if (USE_FALLBACK) {
    if (!warnedAboutFallback && process.env.NODE_ENV !== 'test') {
      warnedAboutFallback = true
      console.warn(
        '[rate-limit] Upstash not configured, using in-memory fallback',
      )
    }
    return checkMemory(bucket, identifier, spec)
  }

  try {
    const limiter = getUpstashLimiter(bucket)
    const res = await withTimeout(limiter.limit(identifier), UPSTASH_TIMEOUT_MS)
    const resetSeconds = Math.ceil(res.reset / 1000)
    const nowSeconds = Math.floor(Date.now() / 1000)
    return {
      success: res.success,
      remaining: res.remaining,
      reset: resetSeconds,
      retryAfter: res.success ? 0 : Math.max(0, resetSeconds - nowSeconds),
    }
  } catch (err) {
    if (!warnedAboutUpstashFailure) {
      warnedAboutUpstashFailure = true
      console.warn(
        `[rate-limit] Upstash call failed (${err instanceof Error ? err.message : 'unknown'}); ` +
          `policy=${FAIL_OPEN ? 'fail-open' : 'fail-closed'}`,
      )
    }
    if (FAIL_OPEN) {
      // Allow the request through. `remaining: 0` signals "we couldn't
      // count this one" to any caller that inspects it without making
      // the result look like a real near-limit response.
      return { success: true, remaining: 0, reset: 0, retryAfter: 0 }
    }
    // Fail-closed: refuse with a short retry-after so callers back off
    // briefly instead of hammering Upstash through the outage.
    return { success: false, remaining: 0, reset: 0, retryAfter: 5 }
  }
}

/**
 * Reset all in-memory rate-limit state. Test-only.
 * @internal
 */
export function __resetForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('[rate-limit] __resetForTests called outside test env')
  }
  memoryStore.clear()
  upstashLimiters.clear()
  cachedRedis = null
  warnedAboutFallback = false
  warnedAboutUpstashFailure = false
}

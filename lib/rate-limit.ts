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

  const limiter = getUpstashLimiter(bucket)
  const res = await limiter.limit(identifier)
  const resetSeconds = Math.ceil(res.reset / 1000)
  const nowSeconds = Math.floor(Date.now() / 1000)
  return {
    success: res.success,
    remaining: res.remaining,
    reset: resetSeconds,
    retryAfter: res.success ? 0 : Math.max(0, resetSeconds - nowSeconds),
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
}

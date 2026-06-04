import type { NextRequest } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { isAllowedOrigin } from '@/lib/security/origin-check'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// ---------------------------------------------------------------------------
// POST /api/posts/[id]/view
//
// Fire-and-forget view-count beacon. Atomically increments posts.view_count
// for the given id (only when deleted_at IS NULL). Always returns 204 — even
// when the post doesn't exist, the id is malformed, the origin is wrong, or
// the IP bucket is full. A differential status code would leak post
// existence or expose the route's gating logic to a probing script.
// No auth required: anonymous view counts are intentional.
//
// Hardening (security/w5):
//   - UUID-shape check on `id`: a malformed id is silently dropped before
//     the RPC, so an attacker can't probe the route with arbitrary strings.
//   - IP-keyed rate limit (60/min) on top of the per-session client beacon.
//     Forging Origin is cheap; a scripted ranker-manipulation attempt now
//     burns through 60 requests/min before getting silenced.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function noContent(): Response {
  return new Response(null, { status: 204 })
}

export async function POST(
  req: NextRequest | Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Origin check inline — we cannot use `guardMutatingRequest` because it
  // would 403/429 on failure and we must return 204 unconditionally to
  // avoid leaking route state.
  const origin = req.headers.get('origin')
  if (!isAllowedOrigin(origin)) {
    return noContent()
  }

  // IP-keyed rate limit. `x-forwarded-for` may be a comma-separated chain;
  // first hop is the client. Falling back to 'unknown' collapses unknown
  // sources into one shared bucket — preferable to skipping the limit.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  try {
    const rl = await checkRateLimit('view_count', `ip:${ip}`)
    if (!rl.success) return noContent()
  } catch {
    // checkRateLimit handles its own errors; this is belt-and-braces so a
    // future regression cannot turn a flaky limiter into a 500 here.
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return noContent()

  const admin = createAdminSupabaseClient()

  // Atomically increment via a SECURITY DEFINER RPC (see migration 0004).
  // We intentionally swallow errors *and* exceptions: the beacon must
  // never surface DB issues or reveal whether a post exists. Supabase
  // returns soft errors via `{ data, error }`, but the underlying fetch
  // can still reject (network blip, DNS, abort) — the try/catch keeps
  // that path 204 too.
  try {
    await admin.rpc('increment_post_view_count', { p_id: id })
  } catch {
    // Intentionally swallowed.
  }

  return noContent()
}

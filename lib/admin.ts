import { notFound } from 'next/navigation'
import { resolveIsAdmin } from '@/lib/auth'
import type { Session } from 'next-auth'

// ---------------------------------------------------------------------------
// JSON helper — same shape as app/api/posts/[id]/route.ts
// ---------------------------------------------------------------------------

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Server-component admin gate
// ---------------------------------------------------------------------------

/**
 * Server-component admin gate. Call at the top of any /admin page.
 * - Missing/anonymous session → notFound() (terminates render with 404).
 * - Authed non-admin → notFound() (we do NOT reveal that /admin exists).
 * - Admin → returns the session.user.id for downstream queries.
 *
 * notFound() throws; this function has return type Promise<string> for the
 * happy path so the caller can `const userId = await requireAdmin(session)`.
 */
export async function requireAdmin(session: Session | null): Promise<string> {
  if (!session?.user?.id) {
    notFound()
  }
  const userId = session.user.id
  const admin = await resolveIsAdmin(userId)
  if (!admin) {
    notFound()
  }
  return userId
}

// ---------------------------------------------------------------------------
// API-route admin gate
// ---------------------------------------------------------------------------

/**
 * API-route admin gate. Returns a Response if the caller should bail out,
 * or null if the caller should continue. Use:
 *
 *   const gate = await requireAdminApi(session)
 *   if (gate) return gate
 *   // ... admin-only work
 *
 * L7 — Both unauthenticated and authed-non-admin callers get the same
 * 404 not_found shape. An asymmetric 401 leaks "this route exists and is
 * admin-only" to anonymous probes, which defeats the misdirection
 * `requireAdmin()` provides for the page version.
 *
 * - Missing/anonymous session → 404 not_found
 * - Authed non-admin → 404 not_found
 * - Admin → null
 */
export async function requireAdminApi(session: Session | null): Promise<Response | null> {
  if (!session?.user?.id) {
    return json(404, { error: 'not_found' })
  }
  const admin = await resolveIsAdmin(session.user.id)
  if (!admin) {
    return json(404, { error: 'not_found' })
  }
  return null
}

import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { guardMutatingRequest } from '@/lib/route-guard'
import { logRouteError } from '@/lib/logging/error-log'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const BioField = z.string().max(2000).nullable()
const AvatarUrlField = z
  .string()
  .refine((s) => s.startsWith('https://'), { message: 'must start with https://' })
  .nullable()

// `.strict()` makes the route reject unknown fields (display_name, username, …).
// Both fields are optional individually; the no-fields-at-all case is handled
// separately so the surfaced error is `no_fields`, not Zod's generic message.
const UsersMePatchBody = z
  .object({
    bio: BioField.optional(),
    avatar_url: AvatarUrlField.optional(),
  })
  .strict()

export async function PATCH(req: NextRequest | Request): Promise<Response> {
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  // Origin guard only — profile edits aren't in the bucket list.
  const guard = await guardMutatingRequest(req, { userId })
  if (guard.failed) return guard.response

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  const parsed = UsersMePatchBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_body',
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    })
  }

  const { bio, avatar_url } = parsed.data
  const update: Record<string, unknown> = {}
  if (bio !== undefined) update.bio = bio
  if (avatar_url !== undefined) update.avatar_url = avatar_url

  if (Object.keys(update).length === 0) {
    return json(400, { error: 'no_fields' })
  }

  const admin = createAdminSupabaseClient()
  const { data, error } = await admin
    .from('users')
    .update(update)
    .eq('id', userId)
    .select('id, bio, avatar_url, updated_at')
    .single()

  if (error || !data) {
    return json(500, { error: 'update_failed', detail: error?.message })
  }

  return json(200, data as Record<string, unknown>)
}

// ---------------------------------------------------------------------------
// DELETE /api/users/me — account self-deletion (anonymisation)
//
// Privacy Policy §8: posts and comments stay attributed to an anonymised
// handle (FK is RESTRICT on author_id), so we cannot remove the
// public.users / next_auth.users rows. We instead:
//   - replace public.users.username with `deleted-<8 hex chars>` and clear
//     bio / avatar_url / display_name / github_login
//   - clear next_auth.users.email / name / image / github_login
//   - delete next_auth.accounts (OAuth linkage) and next_auth.sessions
//     for this user (the latter forces sign-out on the next request)
//
// The endpoint requires `{ confirm: "delete" }` in the body so a CSRF /
// origin-bypass cannot wipe an account with an empty POST.
// ---------------------------------------------------------------------------

const DELETED_HANDLE_PREFIX = 'deleted-'
const MAX_HANDLE_RETRIES = 5

function newDeletedHandle(): string {
  // randomUUID() → "xxxxxxxx-xxxx-...", take the first 8 hex chars.
  return DELETED_HANDLE_PREFIX + randomUUID().slice(0, 8)
}

export async function DELETE(req: NextRequest | Request): Promise<Response> {
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  const guard = await guardMutatingRequest(req, { userId })
  if (guard.failed) return guard.response

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'confirm_required' })
  }
  if (!raw || typeof raw !== 'object' || (raw as { confirm?: unknown }).confirm !== 'delete') {
    return json(400, { error: 'confirm_required' })
  }

  const admin = createAdminSupabaseClient()

  // Pick a fresh deleted-<id> handle, retrying on the unique-constraint
  // collision the public.users.username CHECK enforces. The retry budget
  // covers the (vanishingly small) chance of two simultaneous deletions
  // landing on the same 32-bit prefix.
  let newUsername = newDeletedHandle()
  let updateErr: { message: string; code?: string } | null = null

  for (let attempt = 0; attempt < MAX_HANDLE_RETRIES; attempt++) {
    const { error } = await admin
      .from('users')
      .update({
        username: newUsername,
        display_name: newUsername,
        bio: null,
        avatar_url: null,
        github_login: null,
      })
      .eq('id', userId)
    if (!error) {
      updateErr = null
      break
    }
    // Postgres unique-violation = SQLSTATE 23505. PostgREST returns the
    // code on the error object; fall back to substring match on message.
    const isUniqueViolation =
      error.code === '23505' || /duplicate key|unique constraint/i.test(error.message ?? '')
    if (!isUniqueViolation) {
      updateErr = error
      break
    }
    newUsername = newDeletedHandle()
    updateErr = error
  }

  if (updateErr) {
    logRouteError(updateErr, {
      route: '/api/users/me',
      userId,
      extra: { op: 'anonymise_public_users' },
    })
    return json(500, { error: 'delete_failed', detail: updateErr.message })
  }

  // Clear identity columns on next_auth.users. We keep the row itself so
  // that posts.author_id (RESTRICTed FK back to public.users.id, which in
  // turn FKs to next_auth.users.id) keeps resolving.
  const { error: authErr } = await admin
    .schema('next_auth')
    .from('users')
    .update({ email: null, name: null, image: null, github_login: null })
    .eq('id', userId)
  if (authErr) {
    logRouteError(authErr, {
      route: '/api/users/me',
      userId,
      extra: { op: 'anonymise_next_auth_users' },
    })
    // Already past the point of no return on public.users — surface the
    // partial-success state to the caller instead of pretending success.
    return json(500, { error: 'partial_delete', detail: authErr.message })
  }

  // Drop the OAuth linkage so a re-signin with the same GitHub identity
  // creates a fresh provider row (and a fresh public.users via the
  // sync_user_from_next_auth trigger — different id, different username).
  const { error: accountsErr } = await admin
    .schema('next_auth')
    .from('accounts')
    .delete()
    .eq('userId', userId)
  if (accountsErr) {
    logRouteError(accountsErr, {
      route: '/api/users/me',
      userId,
      extra: { op: 'delete_next_auth_accounts' },
    })
  }

  // Drop active sessions so the next request from the caller's browser
  // is unauthenticated (NextAuth re-issues the cookie on the next sign-in).
  const { error: sessionsErr } = await admin
    .schema('next_auth')
    .from('sessions')
    .delete()
    .eq('userId', userId)
  if (sessionsErr) {
    logRouteError(sessionsErr, {
      route: '/api/users/me',
      userId,
      extra: { op: 'delete_next_auth_sessions' },
    })
  }

  return json(200, { ok: true, username: newUsername })
}

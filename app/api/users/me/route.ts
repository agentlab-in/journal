import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { guardMutatingRequest } from '@/lib/route-guard'
import { logRouteError } from '@/lib/logging/error-log'
import { sanitizeBio } from '@/lib/profile/sanitize-bio'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const BioField = z.string().max(2000).nullable()
// Avatar URLs are stored verbatim and rendered everywhere — including OG
// cards and a raw <img>/<Image> in profile headers. A loose
// `startsWith('https://')` check would let any attacker-controlled host
// land in the column, so we lock down to the two surfaces that can
// legitimately produce an avatar: the Supabase `avatars` public bucket
// and `avatars.githubusercontent.com/u/**` (the URL NextAuth seeds on
// first sign-in). Literal `/..` / `/.` segments are rejected because
// WHATWG URL normalisation collapses them before fetch, which would
// otherwise allow breaking out of the `avatars` bucket.
const AvatarUrlField = z
  .string()
  .nullable()
  .refine(
    (val) => {
      if (val === null || val === '') return true
      let u: URL
      try {
        u = new URL(val)
      } catch {
        return false
      }
      if (u.pathname.includes('/../') || u.pathname.includes('/./')) return false
      const okGithub =
        u.origin === 'https://avatars.githubusercontent.com' &&
        u.pathname.startsWith('/u/')
      if (okGithub) return true
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      if (!supabaseUrl) return false
      let supa: URL
      try {
        supa = new URL(supabaseUrl)
      } catch {
        return false
      }
      return (
        u.origin === supa.origin &&
        u.pathname.startsWith('/storage/v1/object/public/avatars/')
      )
    },
    { message: 'avatar_url must be a Supabase avatars URL or GitHub avatar URL' },
  )

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
  if (bio !== undefined) update.bio = bio === null ? null : sanitizeBio(bio)
  // Coerce '' → null so a cleared avatar persists as NULL instead of an
  // empty string. `next/image` rejects an empty `src` at render time,
  // which would break the profile header otherwise.
  if (avatar_url !== undefined) update.avatar_url = avatar_url === '' ? null : avatar_url

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

  const guard = await guardMutatingRequest(req, { bucket: 'delete_account', userId })
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

  // Once public.users has been anonymised we are past the point of no
  // return — stopping early would leave the caller able to log back in
  // and see their old OAuth linkage attached to a `deleted-xxxxxxxx`
  // profile. Run every remaining cleanup step regardless of individual
  // failures and surface a partial_delete at the end if anything failed.
  const failedOps: string[] = []

  const { error: authErr } = await admin
    .schema('next_auth')
    .from('users')
    .update({ email: null, name: null, image: null, github_login: null })
    .eq('id', userId)
  if (authErr) {
    failedOps.push('anonymise_next_auth_users')
    logRouteError(authErr, {
      route: '/api/users/me',
      userId,
      extra: { op: 'anonymise_next_auth_users' },
    })
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
    failedOps.push('delete_next_auth_accounts')
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
    failedOps.push('delete_next_auth_sessions')
    logRouteError(sessionsErr, {
      route: '/api/users/me',
      userId,
      extra: { op: 'delete_next_auth_sessions' },
    })
  }

  if (failedOps.length > 0) {
    return json(500, {
      error: 'partial_delete',
      username: newUsername,
      failed_ops: failedOps,
    })
  }

  return json(200, { ok: true, username: newUsername })
}

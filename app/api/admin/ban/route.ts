import crypto from 'node:crypto'
import { getSession } from '@/lib/auth'
import { requireAdminApi } from '@/lib/admin'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { AdminBanBody } from '@/lib/admin/schema'
import { guardMutatingRequest } from '@/lib/route-guard'
import { logRouteError } from '@/lib/logging/error-log'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function sha256Lower(value: string): string {
  return crypto.createHash('sha256').update(value.toLowerCase()).digest('hex')
}

export async function POST(req: Request): Promise<Response> {
  const session = await getSession()
  const gate = await requireAdminApi(session)
  if (gate) return gate
  const adminUserId = session!.user.id

  // Origin guard only — admin actions are internal-only; no RL budget.
  const guard = await guardMutatingRequest(req, { userId: adminUserId })
  if (guard.failed) return guard.response

  // Parse body
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'invalid_body' })
  }

  const parsed = AdminBanBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, { error: 'invalid_body', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) })
  }

  const { user_id, reason } = parsed.data

  // Self-ban check
  if (user_id === adminUserId) {
    return json(400, { error: 'self_action' })
  }

  const admin = createAdminSupabaseClient()

  // Lookup target user
  const { data: userRow, error: userFetchErr } = await admin
    .from('users')
    .select('id, username, banned_at')
    .eq('id', user_id)
    .maybeSingle()

  if (userFetchErr || !userRow) {
    return json(404, { error: 'user_not_found' })
  }

  const user = userRow as { id: string; username: string; banned_at: string | null }

  if (user.banned_at !== null) {
    return json(400, { error: 'already_banned' })
  }

  // Ban the user. The 0015 trigger `users_invalidate_sessions_on_ban` deletes
  // next_auth.sessions atomically when banned_at flips NULL → non-NULL, so
  // this single UPDATE is the only required write for session invalidation.
  const { error: banErr } = await admin
    .from('users')
    .update({
      banned_at: new Date().toISOString(),
      banned_reason: reason,
      banned_by: adminUserId,
    })
    .eq('id', user_id)

  if (banErr) {
    return json(500, { error: 'ban_failed', detail: banErr.message })
  }

  // Belt-and-braces: confirm no sessions remain. The trigger should have
  // dropped them in the same transaction as the UPDATE; if a row is still
  // there, the trigger is missing or disabled and we MUST tell the
  // moderator instead of silently returning ok:true.
  const { data: remainingSessions, error: sessionsErr } = await admin
    .schema('next_auth')
    .from('sessions')
    .select('id')
    .eq('userId', user_id)

  if (sessionsErr) {
    logRouteError(sessionsErr, {
      route: '/api/admin/ban',
      userId: adminUserId,
      extra: { op: 'sessions_verify', target_user_id: user_id },
    })
    return json(500, {
      error: 'ban_partial',
      detail: 'user marked banned but session cleanup verification failed; verify trigger',
    })
  }

  if (remainingSessions && (remainingSessions as unknown[]).length > 0) {
    logRouteError(new Error('session invalidator trigger appears inactive'), {
      route: '/api/admin/ban',
      userId: adminUserId,
      extra: {
        op: 'sessions_verify',
        target_user_id: user_id,
        remaining: (remainingSessions as unknown[]).length,
      },
    })
    return json(500, {
      error: 'ban_partial',
      detail: 'user marked banned but sessions remain; verify trigger',
    })
  }

  // Persist a ban fingerprint so the same human can't sign up again with a
  // different email or a second GitHub account. We hash the email so raw PII
  // never lands in this table.
  const naLookup = await admin
    .schema('next_auth')
    .from('users')
    .select('email')
    .eq('id', user_id)
    .maybeSingle<{ email: string | null }>()

  const accountLookup = await admin
    .schema('next_auth')
    .from('accounts')
    .select('"providerAccountId"')
    .eq('userId', user_id)
    .eq('provider', 'github')
    .maybeSingle<{ providerAccountId: string | null }>()

  const email = naLookup.data?.email?.trim() || null
  const providerAccountId = accountLookup.data?.providerAccountId?.trim() || null

  if (email || providerAccountId) {
    // Use email hash as the primary key; if email is missing, fall back to a
    // synthetic key derived from the providerAccountId so we still record the
    // fingerprint. A duplicate hash (e.g. an already-banned email rebanned
    // after un-ban) is upserted to refresh banned_at and providerAccountId.
    const email_hash = sha256Lower(email ?? `gh:${providerAccountId}`)
    const { error: fpErr } = await admin
      .from('ban_fingerprints')
      .upsert(
        {
          email_hash,
          provider_account_id: providerAccountId,
          user_id,
          banned_at: new Date().toISOString(),
        },
        { onConflict: 'email_hash' },
      )
    if (fpErr) {
      logRouteError(fpErr, {
        route: '/api/admin/ban',
        userId: adminUserId,
        extra: { op: 'ban_fingerprint_upsert', target_user_id: user_id },
      })
    }
  } else {
    logRouteError(new Error('no email or providerAccountId for ban fingerprint'), {
      route: '/api/admin/ban',
      userId: adminUserId,
      extra: { op: 'ban_fingerprint_skip', target_user_id: user_id },
    })
  }

  // Write mod_actions
  const { error: modErr } = await admin.from('mod_actions').insert({
    mod_user_id: adminUserId,
    action: 'ban_user',
    target_type: 'user',
    target_id: user_id,
    reason,
    metadata: { username: user.username },
  })

  if (modErr) {
    logRouteError(modErr, {
      route: '/api/admin/ban',
      userId: adminUserId,
      extra: { op: 'mod_actions_insert', target_user_id: user_id },
    })
  }

  return json(200, { ok: true })
}

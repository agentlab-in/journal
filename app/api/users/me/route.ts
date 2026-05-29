import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

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

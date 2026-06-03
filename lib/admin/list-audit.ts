import { createAdminSupabaseClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditActionRow {
  id: string
  created_at: string
  mod_user_id: string
  mod_username: string | null
  action: string
  target_type: string
  target_id: string
  reason: string | null
}

export interface AuditFilters {
  actor?: string // mod_user_id UUID
  target_type?: string
  target_id?: string // mod_actions.target_id (UUID)
  cursor?: string | null // ISO created_at of last row on previous page
}

// ---------------------------------------------------------------------------
// Main list function
// ---------------------------------------------------------------------------

export async function listAuditActions(
  filters: AuditFilters = {},
  limit = 50,
): Promise<{ rows: AuditActionRow[]; nextCursor: string | null }> {
  const { actor, target_type, target_id, cursor } = filters

  const admin = createAdminSupabaseClient()

  let query = admin
    .from('mod_actions')
    .select('id, created_at, mod_user_id, action, target_type, target_id, reason')
    .order('created_at', { ascending: false })
    .limit(limit + 1)

  if (actor) {
    query = query.eq('mod_user_id', actor)
  }

  if (target_type) {
    query = query.eq('target_type', target_type)
  }

  if (target_id) {
    query = query.eq('target_id', target_id)
  }

  if (cursor) {
    query = query.lt('created_at', cursor)
  }

  const { data, error } = await query

  if (error) {
    console.error('[admin/list-audit] query error:', error)
    return { rows: [], nextCursor: null }
  }

  const raw = (data ?? []) as Array<{
    id: string
    created_at: string
    mod_user_id: string
    action: string
    target_type: string
    target_id: string
    reason: string | null
  }>

  const hasMore = raw.length > limit
  const rows = hasMore ? raw.slice(0, limit) : raw
  const nextCursor = hasMore ? (rows[rows.length - 1]?.created_at ?? null) : null

  // Batch-load mod usernames
  const modUserIds = Array.from(new Set(rows.map((r) => r.mod_user_id).filter(Boolean)))
  const modUserMap = new Map<string, string>()

  if (modUserIds.length > 0) {
    const { data: modUsers } = await admin
      .from('users')
      .select('id, username')
      .in('id', modUserIds)

    for (const u of (modUsers ?? []) as Array<{ id: string; username: string }>) {
      modUserMap.set(u.id, u.username)
    }
  }

  const enrichedRows: AuditActionRow[] = rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    mod_user_id: r.mod_user_id,
    mod_username: modUserMap.get(r.mod_user_id) ?? null,
    action: r.action,
    target_type: r.target_type,
    target_id: r.target_id,
    reason: r.reason,
  }))

  return { rows: enrichedRows, nextCursor }
}

import { createAdminSupabaseClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminUserRow {
  id: string
  username: string
  display_name: string | null
  banned_at: string | null
  banned_reason: string | null
  created_at: string
  recent_mod_actions: AdminModActionRow[]
}

export interface AdminModActionRow {
  id: string
  created_at: string
  action: string
  target_type: string
  target_id: string
  reason: string | null
  mod_username: string | null
}

interface SearchUsersOptions {
  q: string
  limit?: number
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

export async function searchUsers(
  opts: SearchUsersOptions,
): Promise<AdminUserRow[]> {
  const { q, limit = 20 } = opts

  const admin = createAdminSupabaseClient()

  // Search by username ILIKE — username = lower(github_login) at sync time
  // so this covers github_login as well. Escape SQL LIKE metacharacters so
  // an admin search like "user_name" doesn't widen to "user<any>name".
  const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`)
  const { data, error } = await admin
    .from('users')
    .select('id, username, display_name, banned_at, banned_reason, created_at')
    .ilike('username', `%${escaped}%`)
    .order('username', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[admin/search-users] query error:', error)
    return []
  }

  const userRows = (data ?? []) as Array<{
    id: string
    username: string
    display_name: string | null
    banned_at: string | null
    banned_reason: string | null
    created_at: string
  }>

  if (userRows.length === 0) return []

  const userIds = userRows.map((u) => u.id)

  // Batch-load last 5 mod_actions per user (target_type='user')
  const { data: modData } = await admin
    .from('mod_actions')
    .select('id, created_at, action, target_type, target_id, reason, mod_user_id')
    .eq('target_type', 'user')
    .in('target_id', userIds)
    .order('created_at', { ascending: false })
    .limit(limit * 5) // fetch enough; we'll trim per user below

  const modRows = (modData ?? []) as Array<{
    id: string
    created_at: string
    action: string
    target_type: string
    target_id: string
    reason: string | null
    mod_user_id: string
  }>

  // Collect unique mod_user_ids to resolve usernames
  const modUserIds = Array.from(new Set(modRows.map((m) => m.mod_user_id).filter(Boolean)))
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

  // Group mod actions by target_id (user id), keep last 5 per user
  const modByUser = new Map<string, AdminModActionRow[]>()
  for (const m of modRows) {
    const existing = modByUser.get(m.target_id) ?? []
    if (existing.length < 5) {
      existing.push({
        id: m.id,
        created_at: m.created_at,
        action: m.action,
        target_type: m.target_type,
        target_id: m.target_id,
        reason: m.reason,
        mod_username: modUserMap.get(m.mod_user_id) ?? null,
      })
      modByUser.set(m.target_id, existing)
    }
  }

  return userRows.map((u) => ({
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    banned_at: u.banned_at,
    banned_reason: u.banned_reason,
    created_at: u.created_at,
    recent_mod_actions: modByUser.get(u.id) ?? [],
  }))
}

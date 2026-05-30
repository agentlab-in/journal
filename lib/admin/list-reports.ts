import { createAdminSupabaseClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportTargetPost {
  type: 'post'
  title: string
  slug: string
  author_username: string
}

export interface ReportTargetComment {
  type: 'comment'
  excerpt: string
  post_slug: string
  post_author_username: string
}

export interface ReportTargetUser {
  type: 'user'
  username: string
}

export type ReportTarget = ReportTargetPost | ReportTargetComment | ReportTargetUser

export interface ReportListRow {
  id: string
  created_at: string
  reporter_username: string | null
  target_type: 'post' | 'comment' | 'user'
  target_id: string
  reason: string
  target: ReportTarget | null
}

interface ListUnresolvedReportsOptions {
  cursor?: string | null // ISO created_at of last row on previous page
  limit?: number
}

// ---------------------------------------------------------------------------
// Helpers for loading target previews
// ---------------------------------------------------------------------------

async function loadPostTarget(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  targetId: string,
): Promise<ReportTargetPost | null> {
  const { data } = await admin
    .from('posts')
    .select('title, slug, type, author_id')
    .eq('id', targetId)
    .maybeSingle()

  if (!data) return null
  const post = data as { title: string; slug: string; type: string; author_id: string }

  const { data: authorData } = await admin
    .from('users')
    .select('username')
    .eq('id', post.author_id)
    .maybeSingle()

  const author = authorData as { username: string } | null

  return {
    type: 'post',
    title: post.title,
    slug: post.slug,
    author_username: author?.username ?? '',
  }
}

async function loadCommentTarget(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  targetId: string,
): Promise<ReportTargetComment | null> {
  const { data } = await admin
    .from('comments')
    .select('body, post_id')
    .eq('id', targetId)
    .maybeSingle()

  if (!data) return null
  const comment = data as { body: string; post_id: string }

  const excerpt = comment.body.slice(0, 80)

  const { data: postData } = await admin
    .from('posts')
    .select('slug, author_id')
    .eq('id', comment.post_id)
    .maybeSingle()

  if (!postData) {
    return { type: 'comment', excerpt, post_slug: '', post_author_username: '' }
  }
  const post = postData as { slug: string; author_id: string }

  const { data: authorData } = await admin
    .from('users')
    .select('username')
    .eq('id', post.author_id)
    .maybeSingle()

  const author = authorData as { username: string } | null

  return {
    type: 'comment',
    excerpt,
    post_slug: post.slug,
    post_author_username: author?.username ?? '',
  }
}

async function loadUserTarget(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  targetId: string,
): Promise<ReportTargetUser | null> {
  const { data } = await admin
    .from('users')
    .select('username')
    .eq('id', targetId)
    .maybeSingle()

  if (!data) return null
  const user = data as { username: string }
  return { type: 'user', username: user.username }
}

// ---------------------------------------------------------------------------
// Main list function
// ---------------------------------------------------------------------------

export async function listUnresolvedReports(
  opts: ListUnresolvedReportsOptions = {},
): Promise<{ rows: ReportListRow[]; nextCursor: string | null }> {
  const { cursor, limit = 25 } = opts

  const admin = createAdminSupabaseClient()

  // Build the base query — unresolved reports, newest first
  let query = admin
    .from('reports')
    .select('id, created_at, reporter_id, target_type, target_id, reason')
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(limit + 1) // fetch one extra to determine if there's a next page

  if (cursor) {
    // created_at DESC cursor: fetch rows strictly older than the cursor
    query = query.lt('created_at', cursor)
  }

  const { data, error } = await query

  if (error) {
    console.error('[admin/list-reports] query error:', error)
    return { rows: [], nextCursor: null }
  }

  const raw = (data ?? []) as Array<{
    id: string
    created_at: string
    reporter_id: string | null
    target_type: 'post' | 'comment' | 'user'
    target_id: string
    reason: string
  }>

  // Determine pagination
  const hasMore = raw.length > limit
  const rows = hasMore ? raw.slice(0, limit) : raw
  const nextCursor = hasMore ? (rows[rows.length - 1]?.created_at ?? null) : null

  // Collect unique reporter IDs to batch-load usernames
  const reporterIds = Array.from(new Set(rows.map((r) => r.reporter_id).filter(Boolean) as string[]))

  const reporterMap = new Map<string, string>()
  if (reporterIds.length > 0) {
    const { data: reporterData } = await admin
      .from('users')
      .select('id, username')
      .in('id', reporterIds)

    if (reporterData) {
      for (const u of reporterData as Array<{ id: string; username: string }>) {
        reporterMap.set(u.id, u.username)
      }
    }
  }

  // Load target previews in parallel
  const enrichedRows: ReportListRow[] = await Promise.all(
    rows.map(async (r) => {
      let target: ReportTarget | null = null

      if (r.target_type === 'post') {
        target = await loadPostTarget(admin, r.target_id)
      } else if (r.target_type === 'comment') {
        target = await loadCommentTarget(admin, r.target_id)
      } else if (r.target_type === 'user') {
        target = await loadUserTarget(admin, r.target_id)
      }

      return {
        id: r.id,
        created_at: r.created_at,
        reporter_username: r.reporter_id ? (reporterMap.get(r.reporter_id) ?? null) : null,
        target_type: r.target_type,
        target_id: r.target_id,
        reason: r.reason,
        target,
      }
    }),
  )

  return { rows: enrichedRows, nextCursor }
}

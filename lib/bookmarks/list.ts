import type { SupabaseClient } from '@supabase/supabase-js'
import type { PostType } from '@/lib/posts/url'

export interface BookmarkedPostAuthor {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
}

export interface BookmarkedPost {
  id: string
  type: PostType
  slug: string
  title: string
  summary: string
  cover_image_url: string | null
  published_at: string
  view_count: number
  comment_count: number
  bookmarked_at: string
  author: BookmarkedPostAuthor
}

// TODO(phase-9): paginate. v1 caps the list at 100 — heavy bookmarkers can
// exceed this within weeks. Likely shape: cursor on bookmarks.created_at
// (already the ORDER BY column) + `LIMIT 50` per page. Mirrors the
// followers/following list pages.
const LIST_LIMIT = 100

interface JoinedAuthor {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
}

interface JoinedPost {
  id: string
  type: string
  slug: string
  title: string
  summary: string
  cover_image_url: string | null
  published_at: string
  view_count: number
  comment_count: number | null
  deleted_at: string | null
  users: JoinedAuthor | null
}

interface JoinedRow {
  created_at: string
  posts: JoinedPost | null
}

/**
 * List up to 100 bookmarked posts for `userId`, ordered newest-first by
 * `bookmarks.created_at`.
 *
 * Requires the admin (service-role) client — `public.bookmarks` is
 * owner-only-read under RLS (migration 0002), and the page request runs
 * under next-auth not a Supabase JWT, so the anon SSR client would return
 * zero rows.
 *
 * Defensive: skips rows whose joined post is null (hard-deleted) or
 * soft-deleted via `deleted_at`.
 */
export async function listUserBookmarks(
  admin: Pick<SupabaseClient, 'from'>,
  userId: string,
): Promise<BookmarkedPost[]> {
  const { data, error } = await admin
    .from('bookmarks')
    .select(
      `created_at, posts(id, type, slug, title, summary, cover_image_url, published_at, view_count, comment_count, deleted_at, users:author_id(id, username, display_name, avatar_url))`,
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT)

  if (error || !data) return []
  const rows = data as unknown as JoinedRow[]

  const out: BookmarkedPost[] = []
  for (const r of rows) {
    const p = r.posts
    if (!p) continue
    if (p.deleted_at !== null && p.deleted_at !== undefined) continue
    const author = p.users
    if (!author) continue
    out.push({
      id: p.id,
      type: p.type as PostType,
      slug: p.slug,
      title: p.title,
      summary: p.summary,
      cover_image_url: p.cover_image_url,
      published_at: p.published_at,
      view_count: p.view_count,
      comment_count: p.comment_count ?? 0,
      bookmarked_at: r.created_at,
      author: {
        id: author.id,
        username: author.username,
        display_name: author.display_name,
        avatar_url: author.avatar_url,
      },
    })
  }
  return out
}

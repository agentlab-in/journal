/**
 * Public entry points for the home-feed module.
 *
 *   getLatestFeed(db): most recent non-deleted, published posts,
 *                       reverse-chronological.
 *
 * Reads only `public.posts` for public columns and works with the anon
 * client; the anon home-page render in `app/page.tsx` passes one.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const LATEST_DEFAULT_LIMIT = 30

export interface ShortlistRow {
  id: string
  author_id: string
  type: 'post' | 'playbook' | 'dive'
  slug: string
  title: string
  summary: string
  cover_image_url: string | null
  published_at: string
  like_count: number
  bookmark_count: number
  comment_count: number
}

interface PostsLatestRow {
  id: string
  author_id: string
  type: string
  slug: string
  title: string
  summary: string
  cover_image_url: string | null
  published_at: string
  like_count: number | null
  bookmark_count: number | null
  comment_count: number | null
}

/**
 * Most recent non-deleted, published posts, reverse-chronological. Used
 * for the homepage feed and as a safety net when there's nothing more
 * specific to show.
 */
export async function getLatestFeed(
  db: Pick<SupabaseClient, 'from'>,
  options: { limit?: number } = {},
): Promise<ShortlistRow[]> {
  const limit = options.limit ?? LATEST_DEFAULT_LIMIT

  const { data, error } = await db
    .from('posts')
    .select(
      'id, author_id, type, slug, title, summary, cover_image_url, published_at, like_count, bookmark_count, comment_count',
    )
    .is('deleted_at', null)
    .lte('published_at', new Date().toISOString())
    .order('published_at', { ascending: false })
    .limit(limit)

  if (error || !Array.isArray(data)) return []

  return (data as PostsLatestRow[]).map((r) => ({
    id: r.id,
    author_id: r.author_id,
    type: r.type as ShortlistRow['type'],
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    cover_image_url: r.cover_image_url,
    published_at: r.published_at,
    like_count: r.like_count ?? 0,
    bookmark_count: r.bookmark_count ?? 0,
    comment_count: r.comment_count ?? 0,
  }))
}

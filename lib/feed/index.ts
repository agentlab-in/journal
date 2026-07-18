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

export interface LatestFeedRow {
  id: string
  author_id: string
  type: 'post' | 'playbook' | 'dive'
  slug: string
  title: string
  summary: string
  cover_image_url: string | null
  published_at: string
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
}

/**
 * Most recent non-deleted, published posts, reverse-chronological. Used
 * for the homepage feed and as a safety net when there's nothing more
 * specific to show.
 */
export async function getLatestFeed(
  db: Pick<SupabaseClient, 'from'>,
  options: { limit?: number } = {},
): Promise<LatestFeedRow[]> {
  const limit = options.limit ?? LATEST_DEFAULT_LIMIT

  const { data, error } = await db
    .from('posts')
    .select(
      'id, author_id, type, slug, title, summary, cover_image_url, published_at',
    )
    .is('deleted_at', null)
    .lte('published_at', new Date().toISOString())
    .order('published_at', { ascending: false })
    .limit(limit)

  if (error || !Array.isArray(data)) return []

  return (data as PostsLatestRow[]).map((r) => ({
    id: r.id,
    author_id: r.author_id,
    type: r.type as LatestFeedRow['type'],
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    cover_image_url: r.cover_image_url,
    published_at: r.published_at,
  }))
}

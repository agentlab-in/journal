/**
 * Hydration helpers for feed surfaces (home / latest / tag / search).
 *
 * Feed queries (`getForYouFeed`, `getLatestFeed`, the `/tag/[slug]` posts
 * query) return rows that carry an `author_id` and — sometimes — a list of
 * approved tag slugs. These helpers turn those ids/slugs into the small
 * lookup maps the row → `PostCardData` projection needs.
 *
 * Everything here is RLS-friendly: callers pass whichever Supabase client
 * they're already using for the feed read, so the anon vs admin choice
 * stays at the page level.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuthorInfo {
  username: string
  display_name: string | null
  avatar_url: string | null
}

export interface TagInfo {
  slug: string
  name: string
}

interface AuthorRow {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
}

interface TagJoinRow {
  post_id: string
  tag_slug: string
  tags: { slug: string; name: string; is_approved: boolean } | null
}

interface TagRow {
  slug: string
  name: string
}

/**
 * Hydrate author info for a set of post rows. Returns a Map keyed on the
 * `id` column the caller passed in (`users.id`). Empty Map on error or
 * missing data so the caller can skip rows whose author row vanished
 * (FK is RESTRICT, so this should not happen — defensive only).
 */
export async function fetchAuthors(
  db: Pick<SupabaseClient, 'from'>,
  authorIds: string[],
): Promise<Map<string, AuthorInfo>> {
  if (authorIds.length === 0) return new Map()
  const { data, error } = await db
    .from('users')
    .select('id, username, display_name, avatar_url')
    .in('id', authorIds)
  if (error || !Array.isArray(data)) return new Map()
  const out = new Map<string, AuthorInfo>()
  for (const r of data as AuthorRow[]) {
    out.set(r.id, {
      username: r.username,
      display_name: r.display_name,
      avatar_url: r.avatar_url,
    })
  }
  return out
}

/**
 * Attach approved tags (max 2, slug-asc) to a set of post ids. Used by
 * feed surfaces where the underlying query did not already return tag
 * slugs (e.g. anon /latest, /tag/[slug]).
 *
 * Sort is alphabetical by slug for a stable cap-to-2 — feeds should not
 * flicker between renders just because PostgREST changed join order.
 */
export async function fetchTagsByPost(
  db: Pick<SupabaseClient, 'from'>,
  postIds: string[],
): Promise<Map<string, TagInfo[]>> {
  const out = new Map<string, TagInfo[]>()
  if (postIds.length === 0) return out
  const { data, error } = await db
    .from('post_tags')
    .select('post_id, tag_slug, tags!inner(slug, name, is_approved)')
    .in('post_id', postIds)
    .eq('tags.is_approved', true)
  if (error || !Array.isArray(data)) return out
  const rows = data as unknown as TagJoinRow[]
  const grouped = new Map<string, TagInfo[]>()
  for (const r of rows) {
    if (!r.tags) continue
    const slug = r.tags.slug ?? r.tag_slug
    const name = r.tags.name ?? slug
    if (!slug) continue
    const list = grouped.get(r.post_id)
    const entry = { slug, name }
    if (list) list.push(entry)
    else grouped.set(r.post_id, [entry])
  }
  for (const [id, list] of grouped) {
    list.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    out.set(id, list.slice(0, 2))
  }
  return out
}

/**
 * Resolve display names for a set of tag slugs. Used by the For-You feed
 * path — `getForYouFeed` returns slugs only, but `PostCard` wants names.
 */
export async function fetchTagNames(
  db: Pick<SupabaseClient, 'from'>,
  slugs: string[],
): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map()
  const { data, error } = await db
    .from('tags')
    .select('slug, name')
    .in('slug', slugs)
  if (error || !Array.isArray(data)) return new Map()
  const out = new Map<string, string>()
  for (const r of data as TagRow[]) out.set(r.slug, r.name)
  return out
}

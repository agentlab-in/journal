import Link from 'next/link'
import type { Metadata } from 'next'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createAnonServerSupabaseClient } from '@/lib/supabase/server'
import {
  getForYouFeed,
  getLatestFeed,
  type RerankRow,
  type ShortlistRow,
} from '@/lib/feed'
import { PostCard, type PostCardData } from '@/components/post/PostCard'

export const metadata: Metadata = {
  title: 'agentlab.in',
  description: 'Community publishing for AI agent infrastructure.',
  alternates: { canonical: '/' },
}

interface AuthorInfo {
  username: string
  display_name: string | null
  avatar_url: string | null
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
 * `id` column the caller passed in (`users.id` here). Empty Map on error
 * or missing data so the caller can skip rows whose author row vanished
 * (FK is RESTRICT, so this should not happen — defensive only).
 */
async function fetchAuthors(
  db: SupabaseClient,
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
 * Resolve display names for a set of tag slugs (For You path only —
 * `getForYouFeed` returns slugs, not display names).
 */
async function fetchTagNames(
  db: SupabaseClient,
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

/**
 * Attach approved tags (max 2, slug-asc) to a set of post ids. Used by
 * the anon Latest path because `getLatestFeed` doesn't return tags.
 */
async function fetchTagsByPost(
  db: SupabaseClient,
  postIds: string[],
): Promise<Map<string, Array<{ slug: string; name: string }>>> {
  const out = new Map<string, Array<{ slug: string; name: string }>>()
  if (postIds.length === 0) return out
  const { data, error } = await db
    .from('post_tags')
    .select('post_id, tag_slug, tags!inner(slug, name, is_approved)')
    .in('post_id', postIds)
    .eq('tags.is_approved', true)
  if (error || !Array.isArray(data)) return out
  const rows = data as unknown as TagJoinRow[]
  const grouped = new Map<string, Array<{ slug: string; name: string }>>()
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
  // Sort alphabetically by slug for a stable cap-to-2 — feeds should not
  // flicker between renders just because PostgREST changed join order.
  for (const [id, list] of grouped) {
    list.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    out.set(id, list.slice(0, 2))
  }
  return out
}

type FeedRow = RerankRow | ShortlistRow

function rowHasTagSlugs(row: FeedRow): row is RerankRow {
  return Array.isArray((row as RerankRow).tag_slugs)
}

/**
 * Build the displayable card list from feed rows + the lookup maps.
 * Rows whose author cannot be resolved are skipped (defensive — FK is
 * RESTRICT so this is effectively unreachable in production).
 */
function buildCards(
  rows: FeedRow[],
  authorMap: Map<string, AuthorInfo>,
  tagNameMap: Map<string, string>,
  anonTagMap: Map<string, Array<{ slug: string; name: string }>>,
): PostCardData[] {
  const cards: PostCardData[] = []
  for (const r of rows) {
    const author = authorMap.get(r.author_id)
    if (!author) continue
    let tags: Array<{ slug: string; name: string }>
    if (rowHasTagSlugs(r)) {
      tags = r.tag_slugs
        .slice(0, 2)
        .map((slug) => ({ slug, name: tagNameMap.get(slug) ?? slug }))
    } else {
      tags = anonTagMap.get(r.id) ?? []
    }
    cards.push({
      id: r.id,
      type: r.type as PostCardData['type'],
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      published_at: r.published_at,
      like_count: r.like_count,
      bookmark_count: r.bookmark_count,
      comment_count: r.comment_count,
      author: {
        username: author.username,
        display_name: author.display_name ?? author.username,
        avatar_url: author.avatar_url,
      },
      tags,
    })
  }
  return cards
}

export default async function HomePage() {
  const session = await getSession()
  const viewerId = session?.user?.id ?? null

  let rows: FeedRow[] = []
  let db: SupabaseClient
  let usedAuthedPath = false

  if (viewerId) {
    // Authed: service-role client because `getForYouFeed` reads likes /
    // bookmarks / follows that the anon role can't see.
    db = createAdminSupabaseClient()
    try {
      rows = await getForYouFeed(db, viewerId)
      usedAuthedPath = true
    } catch (err) {
      console.error('[home] getForYouFeed failed, falling back to latest:', err)
      try {
        rows = await getLatestFeed(db)
      } catch (innerErr) {
        console.error('[home] fallback getLatestFeed also failed:', innerErr)
        rows = []
      }
    }
  } else {
    // Anon: RLS-gated client. Public-read policies on posts/users/tags
    // already expose what `getLatestFeed` needs.
    db = createAnonServerSupabaseClient()
    try {
      rows = await getLatestFeed(db)
    } catch (err) {
      console.error('[home] getLatestFeed failed:', err)
      rows = []
    }
  }

  // Hydrate authors. Use the same db client we used for the feed read so
  // the authed path bypasses RLS and the anon path stays on public reads.
  const uniqueAuthorIds = Array.from(new Set(rows.map((r) => r.author_id)))
  const authorMap = await fetchAuthors(db, uniqueAuthorIds)

  // Tag hydration — different shape depending on whether the rows came
  // back with `tag_slugs` (authed/For-You) or without (anon/Latest).
  let tagNameMap = new Map<string, string>()
  let anonTagMap = new Map<string, Array<{ slug: string; name: string }>>()
  if (rows.length > 0) {
    if (rowHasTagSlugs(rows[0])) {
      const allSlugs = new Set<string>()
      for (const r of rows) {
        if (rowHasTagSlugs(r)) {
          for (const s of r.tag_slugs.slice(0, 2)) allSlugs.add(s)
        }
      }
      tagNameMap = await fetchTagNames(db, Array.from(allSlugs))
    } else {
      anonTagMap = await fetchTagsByPost(
        db,
        rows.map((r) => r.id),
      )
    }
  }

  const cards = buildCards(rows, authorMap, tagNameMap, anonTagMap)
  const showingForYou = viewerId !== null && usedAuthedPath

  return (
    <main className="home-feed">
      <header className="home-feed__header">
        <h1 className="home-feed__title">{showingForYou ? 'For you' : 'Latest'}</h1>
        <p className="home-feed__tagline">
          {showingForYou
            ? 'Posts ranked by recency and engagement, biased toward tags you follow.'
            : 'The newest posts on agentlab.'}
        </p>
      </header>

      {cards.length === 0 ? (
        <p className="home-feed__empty">Nothing here yet. Be the first to publish.</p>
      ) : (
        <ul className="home-feed__list">
          {cards.map((c) => (
            <li key={c.id} className="home-feed__item">
              <PostCard post={c} />
            </li>
          ))}
        </ul>
      )}

      <p className="home-feed__more">
        <Link href="/latest">See all posts →</Link>
      </p>
    </main>
  )
}

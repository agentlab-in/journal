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
import {
  fetchAuthors,
  fetchTagNames,
  fetchTagsByPost,
  type AuthorInfo,
  type TagInfo,
} from '@/lib/feed/hydrate'
import { PostCard, type PostCardData } from '@/components/post/PostCard'

export const metadata: Metadata = {
  title: 'agentlab.in',
  description: 'Community publishing for AI agent infrastructure.',
  alternates: { canonical: '/' },
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
  anonTagMap: Map<string, TagInfo[]>,
): PostCardData[] {
  const cards: PostCardData[] = []
  for (const r of rows) {
    const author = authorMap.get(r.author_id)
    if (!author) continue
    let tags: TagInfo[]
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
  let anonTagMap = new Map<string, TagInfo[]>()
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

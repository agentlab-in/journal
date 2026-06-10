import Link from 'next/link'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth'
import { requireConsentOrRedirect } from '@/lib/consent/require-consent'
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
  fetchOrgsByPost,
  fetchTagNames,
  fetchTagsByPost,
  type AuthorInfo,
  type OrgInfo,
  type TagInfo,
} from '@/lib/feed/hydrate'
import { PostCard, type PostCardData } from '@/components/post/PostCard'
import { KeyboardFeedNav } from '@/components/keyboard/KeyboardFeedNav'
import { PostCardSkeleton } from '@/components/skeleton/PostCardSkeleton'
import { RailSkeleton } from '@/components/skeleton/RailSkeleton'
import { HomeShell } from '@/components/home/HomeShell'
import { LeftSidebar } from '@/components/home/LeftSidebar'
import { RightSidebar } from '@/components/home/RightSidebar'
import { TrendingStrip } from '@/components/home/TrendingStrip'
import { TopByType } from '@/components/home/TopByType'

export const metadata: Metadata = {
  // Home is the one route that ISN'T `{label} — agentlab.in`. It's
  // just the site name. `title.absolute` bypasses the layout-level
  // `'%s — agentlab.in'` template so we don't get the awkward
  // `'agentlab.in — agentlab.in'`.
  title: { absolute: 'agentlab.in' },
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
  orgMap: Map<string, OrgInfo>,
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
      org: orgMap.get(r.id) ?? null,
      tags,
    })
  }
  return cards
}

/**
 * Slow async boundary — 3-5 Supabase round-trips (feed read + author
 * hydration + tag hydration). Extracted into its own server component so
 * the page shell (header/title/tagline + "see all" link) paints
 * instantly and this streams in under a Suspense fallback.
 *
 * `viewerId` is passed in (already resolved by the page) so the fast
 * JWT-decode `getSession()` call doesn't block the shell from rendering.
 */
async function FeedList({ viewerId }: { viewerId: string | null }) {
  let rows: FeedRow[] = []
  let db: SupabaseClient

  if (viewerId) {
    // Authed: service-role client because `getForYouFeed` reads likes /
    // bookmarks / follows that the anon role can't see.
    db = createAdminSupabaseClient()
    try {
      rows = await getForYouFeed(db, viewerId)
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
  const [authorMap, orgMap] = await Promise.all([
    fetchAuthors(db, uniqueAuthorIds),
    fetchOrgsByPost(db, rows.map((r) => r.id)),
  ])

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

  const cards = buildCards(rows, authorMap, tagNameMap, anonTagMap, orgMap)

  if (cards.length === 0) {
    return (
      <p className="home-feed__empty">
        Follow people or wait while the feed warms up. Start with{' '}
        <Link href="/tags">/tags</Link>.
      </p>
    )
  }

  return (
    <KeyboardFeedNav>
      <ul className="home-feed__list">
        {cards.map((c) => (
          <li key={c.id} className="home-feed__item">
            <PostCard post={c} />
          </li>
        ))}
      </ul>
    </KeyboardFeedNav>
  )
}

export default async function HomePage() {
  // Cheap JWT decode — kept out of the Suspense boundary so the H1 +
  // tagline copy that depends on auth state can paint with the shell.
  const session = await getSession()
  if (session?.user?.id) {
    await requireConsentOrRedirect(session.user.id)
  }
  const viewerId = session?.user?.id ?? null
  const showingForYou = viewerId !== null

  return (
    <HomeShell
      left={<LeftSidebar />}
      center={
        <main id="main-content" className="home-feed">
          {/* Mobile-only (<lg) horizontal trending strip. TrendingStrip
              self-hides at ≥lg via lg:hidden so no server-side branching
              is needed — pure CSS responsive. */}
          <Suspense fallback={null}>
            <TrendingStrip />
          </Suspense>

          <header className="home-feed__header">
            <h1 className="home-feed__title">{showingForYou ? 'For you' : 'Latest'}</h1>
            <p className="home-feed__tagline">
              {showingForYou
                ? 'Posts ranked by recency and engagement, biased toward tags you follow.'
                : 'The newest posts on agentlab.'}
            </p>
          </header>

          <Suspense fallback={<PostCardSkeleton count={5} />}>
            <FeedList viewerId={viewerId} />
          </Suspense>

          <p className="home-feed__more">
            <Link href="/latest">See all posts →</Link>
          </p>

          {/* Mobile-only (<lg) top-by-type rails below the feed footer.
              Both sidebars are hidden at <lg so these rails would otherwise
              be invisible. lg:hidden keeps them out of the desktop layout
              where the right sidebar already shows them. */}
          <div className="lg:hidden">
            <Suspense fallback={<RailSkeleton rows={3} />}>
              <TopByType type="playbook" />
            </Suspense>
            <Suspense fallback={<RailSkeleton rows={3} />}>
              <TopByType type="dive" />
            </Suspense>
          </div>
        </main>
      }
      right={<RightSidebar />}
    />
  )
}

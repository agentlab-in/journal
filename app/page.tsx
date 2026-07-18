import Link from 'next/link'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { createAnonServerSupabaseClient } from '@/lib/supabase/server'
import { getLatestFeed, type ShortlistRow } from '@/lib/feed'
import {
  fetchAuthors,
  fetchOrgsByPost,
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

/**
 * Build the displayable card list from feed rows + the lookup maps.
 * Rows whose author cannot be resolved are skipped (defensive — FK is
 * RESTRICT so this is effectively unreachable in production).
 */
function buildCards(
  rows: ShortlistRow[],
  authorMap: Map<string, AuthorInfo>,
  anonTagMap: Map<string, TagInfo[]>,
  orgMap: Map<string, OrgInfo>,
): PostCardData[] {
  const cards: PostCardData[] = []
  for (const r of rows) {
    const author = authorMap.get(r.author_id)
    if (!author) continue
    cards.push({
      id: r.id,
      type: r.type as PostCardData['type'],
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      published_at: r.published_at,
      author: {
        username: author.username,
        display_name: author.display_name ?? author.username,
        avatar_url: author.avatar_url,
      },
      org: orgMap.get(r.id) ?? null,
      tags: anonTagMap.get(r.id) ?? [],
    })
  }
  return cards
}

/**
 * Slow async boundary — 3-5 Supabase round-trips (feed read + author
 * hydration + tag hydration). Extracted into its own server component so
 * the page shell (header/title/tagline + "see all" link) paints
 * instantly and this streams in under a Suspense fallback.
 */
async function FeedList() {
  // Anon: RLS-gated client. Public-read policies on posts/users/tags
  // already expose what `getLatestFeed` needs.
  const db = createAnonServerSupabaseClient()
  let rows: ShortlistRow[] = []
  try {
    rows = await getLatestFeed(db)
  } catch (err) {
    console.error('[home] getLatestFeed failed:', err)
    rows = []
  }

  // Hydrate authors, orgs, and tags in a single Promise.all; all three
  // reads depend only on `rows`.
  const uniqueAuthorIds = Array.from(new Set(rows.map((r) => r.author_id)))
  const ids = rows.map((r) => r.id)

  const [authorMap, orgMap, anonTagMap] = await Promise.all([
    fetchAuthors(db, uniqueAuthorIds),
    fetchOrgsByPost(db, ids),
    fetchTagsByPost(db, ids),
  ])

  const cards = buildCards(rows, authorMap, anonTagMap, orgMap)

  if (cards.length === 0) {
    return (
      <p className="home-feed__empty">
        Nothing published yet. Browse <Link href="/tags">/tags</Link> to see
        what topics are here.
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

export default function HomePage() {
  return (
    <HomeShell
      left={<LeftSidebar />}
      center={
        <main id="main-content" className="home-feed">
          <header className="home-feed__header">
            <h1 className="home-feed__title">Latest</h1>
            <p className="home-feed__tagline">The newest posts on agentlab.</p>
          </header>

          <Suspense fallback={<PostCardSkeleton count={5} />}>
            <FeedList />
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
              {/* unique headingId avoids duplicate-id-aria: RightSidebar owns the default ids at ≥lg */}
              <TopByType type="playbook" headingId="top-playbook-heading-mobile" />
            </Suspense>
            <Suspense fallback={<RailSkeleton rows={3} />}>
              {/* unique headingId avoids duplicate-id-aria: RightSidebar owns the default ids at ≥lg */}
              <TopByType type="dive" headingId="top-dive-heading-mobile" />
            </Suspense>
          </div>
        </main>
      }
      right={<RightSidebar />}
    />
  )
}

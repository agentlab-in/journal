/**
 * /trending — global heat-ranked feed route.
 *
 * Anon-readable: no auth gate, no consent redirect. Compare: `/latest`
 * (app/latest/page.tsx) which has the same open posture.
 *
 * Three-column layout mirrors `app/page.tsx` post-Phase-B. The center column
 * streams in the TrendingFeed under a PostCardSkeleton fallback. Mobile
 * (<lg) breakpoints mirror home: TrendingStrip above the header, and the
 * mobile TopByType rails below the footer link.
 *
 * JSON-LD is intentionally omitted — matches /latest, which ships metadata
 * only (no structured data).
 *
 * force-dynamic: TrendingFeed calls the Supabase admin client (live DB read
 * via the `feed_shortlist_by_heat` RPC) so static prerendering at build time
 * would fail without a real Supabase URL. Matches the posture of /tags and
 * the other data-backed routes in this codebase.
 */

import Link from 'next/link'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { HomeShell } from '@/components/home/HomeShell'
import { LeftSidebar } from '@/components/home/LeftSidebar'
import { RightSidebar } from '@/components/home/RightSidebar'
import { TrendingStrip } from '@/components/home/TrendingStrip'
import { TrendingFeed } from '@/components/home/TrendingFeed'
import { TopByType } from '@/components/home/TopByType'
import { PostCardSkeleton } from '@/components/skeleton/PostCardSkeleton'
import { RailSkeleton } from '@/components/skeleton/RailSkeleton'

// force-dynamic: TrendingFeed calls the Supabase admin client (live DB read
// via the `feed_shortlist_by_heat` RPC) so static prerendering at build time
// would fail without a real Supabase URL. Matches the posture of /tags and
// the other data-backed routes in this codebase.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Trending',
  description: 'What people are reading this week on agentlab.',
  alternates: { canonical: '/trending' },
}

export default function TrendingPage() {
  return (
    <HomeShell
      left={<LeftSidebar />}
      center={
        <main id="main-content" className="home-feed">
          {/* Mobile-only (<lg) horizontal trending strip. Mirrors app/page.tsx. */}
          <Suspense fallback={null}>
            <TrendingStrip />
          </Suspense>

          <header className="home-feed__header">
            <h1 className="home-feed__title">Trending</h1>
            <p className="home-feed__tagline">
              What people are reading this week.
            </p>
          </header>

          <Suspense fallback={<PostCardSkeleton count={5} />}>
            <TrendingFeed />
          </Suspense>

          <p className="home-feed__more">
            <Link href="/latest">See newest first →</Link>
          </p>

          {/* Mobile-only (<lg) top-by-type rails below the feed footer.
              Both sidebars are hidden at <lg so these rails would otherwise
              be invisible. lg:hidden keeps them out of the desktop layout
              where the right sidebar already shows them.
              Unique headingIds avoid duplicate-id-aria (RightSidebar owns
              the default ids at ≥lg). */}
          <div className="lg:hidden">
            <Suspense fallback={<RailSkeleton rows={3} />}>
              <TopByType type="playbook" headingId="top-playbook-heading-trending-mobile" />
            </Suspense>
            <Suspense fallback={<RailSkeleton rows={3} />}>
              <TopByType type="dive" headingId="top-dive-heading-trending-mobile" />
            </Suspense>
          </div>
        </main>
      }
      right={<RightSidebar />}
    />
  )
}

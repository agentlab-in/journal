/**
 * RightSidebar — lg-only right column (hidden below lg=1024 px).
 *
 * Phase B: replaces the Phase A skeleton stubs with the real data-backed
 * rails.
 *
 * Responsive matrix:
 *   xl (>=1280 px) — LeftSidebar is visible; TrendingTagsRail lives there.
 *                    The `xl:hidden` wrapper below ensures no duplicate.
 *   lg (1024-1279) — LeftSidebar is hidden; TrendingTagsRail relocates here
 *                    (inside `hidden lg:block xl:hidden`).
 *   <lg            — Both sidebars are hidden; TrendingStrip handles mobile.
 *
 * Trade-off accepted (per plan): the parent awaits both cached queries before
 * the children stream, enabling the `bothEmpty` fallback check.  In practice
 * both calls are cache-hot and sub-millisecond after the first request.
 *
 * Server async component.
 */

import { Suspense } from 'react'
import { cachedTopPlaybooks, cachedTopDives } from '@/lib/feed/discovery-cache'
import { TrendingTagsRail } from './TrendingTagsRail'
import { TopByType } from './TopByType'
import { FeaturedTagsFallback } from './FeaturedTagsFallback'
import { RailSkeleton } from '@/components/skeleton/RailSkeleton'

export async function RightSidebar() {
  // Same cached calls TopByType makes — cache-hot in practice, so this is
  // a lookup, not extra round-trips.
  const [playbooks, dives] = await Promise.all([
    cachedTopPlaybooks(),
    cachedTopDives(),
  ])
  const bothEmpty = playbooks.length === 0 && dives.length === 0

  return (
    <div className="right-sidebar flex flex-col gap-8">
      {/* lg-only: left sidebar is hidden at lg, so the trending rail
          relocates here, above the playbooks (responsive matrix).
          xl:hidden avoids duplicating it next to LeftSidebar's copy. */}
      <div className="hidden lg:block xl:hidden">
        <Suspense fallback={<RailSkeleton rows={5} />}>
          <TrendingTagsRail />
        </Suspense>
      </div>

      <Suspense fallback={<RailSkeleton rows={3} />}>
        <TopByType type="playbook" />
      </Suspense>

      <Suspense fallback={<RailSkeleton rows={3} />}>
        <TopByType type="dive" />
      </Suspense>

      {bothEmpty && <FeaturedTagsFallback />}
    </div>
  )
}

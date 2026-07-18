/**
 * RightSidebar — lg-only right column (hidden below lg=1024 px).
 *
 * Consolidated discovery rail. The left column is nav-only, so all discovery
 * lives here in a single stack, top to bottom:
 *   1. TopByType (playbook, dive): most recent posts per type.
 *   2. FeaturedTagsFallback: only when both top-by-type rails are empty.
 *
 * Responsive matrix:
 *   lg+ (>=1024 px): this rail is visible.
 *   <lg: both sidebars are hidden; the center column renders its own
 *        mobile copy of the top-by-type rails.
 *
 * Trade-off accepted (per plan): the parent awaits both cached queries before
 * the children stream, enabling the `bothEmpty` fallback check.  In practice
 * both calls are cache-hot and sub-millisecond after the first request.
 *
 * Server async component.
 */

import { Suspense } from 'react'
import { cachedTopPlaybooks, cachedTopDives } from '@/lib/feed/discovery-cache'
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

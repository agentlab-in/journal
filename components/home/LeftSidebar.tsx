/**
 * LeftSidebar — xl-only left column (hidden below xl=1280 px).
 *
 * Renders LeftNav at the top, then streams in TrendingTagsRail below it
 * once the data-layer query resolves (Phase B).
 *
 * Server component, synchronous — no 'use client', no async/await.
 * TrendingTagsRail is itself async; it is wrapped in Suspense here so the
 * shell renders immediately with the skeleton while the cached query is
 * in-flight.
 */

import { Suspense } from 'react'
import { LeftNav } from './LeftNav'
import { TrendingTagsRail } from './TrendingTagsRail'
import { RailSkeleton } from '@/components/skeleton/RailSkeleton'

export function LeftSidebar() {
  return (
    <div className="left-sidebar">
      <LeftNav />
      <Suspense fallback={<RailSkeleton rows={5} />}>
        <TrendingTagsRail />
      </Suspense>
    </div>
  )
}

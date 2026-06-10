/**
 * LeftSidebar — Phase A stub.
 *
 * Renders LeftNav only. TrendingTagsRail lands in Phase B once the data
 * layer is wired up.
 *
 * Server component, synchronous — no 'use client', no async/await.
 */

import { LeftNav } from './LeftNav'

export function LeftSidebar() {
  return (
    <div className="left-sidebar">
      <LeftNav />
    </div>
  )
}

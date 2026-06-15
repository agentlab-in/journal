/**
 * LeftSidebar — xl-only left column (hidden below xl=1280 px).
 *
 * Nav-only: renders just LeftNav. Discovery rails (trending tags, top-by-type,
 * featured-tags fallback) all live in RightSidebar so discovery is consolidated
 * on a single rail and the left column stays purely navigational.
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

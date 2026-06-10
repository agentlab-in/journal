/**
 * RightSidebar — Phase A stub.
 *
 * Renders two RailSkeleton placeholders (rows=3 each) to show the
 * right sidebar region is occupied while Phase B wires up the actual
 * data-backed rails (TrendingTagsRail etc.).
 *
 * This is intentional — skeletons here signal to the reader that content
 * is coming, while keeping Phase A purely about layout scaffolding.
 *
 * Server component, synchronous — no 'use client', no async/await.
 */

import { RailSkeleton } from '@/components/skeleton/RailSkeleton'

export function RightSidebar() {
  return (
    <div className="right-sidebar flex flex-col gap-6">
      <RailSkeleton rows={3} />
      <RailSkeleton rows={3} />
    </div>
  )
}

/**
 * RailSkeleton — sidebar-rail-shaped loading placeholder.
 *
 * Used as a stand-in for TopByType and similar vertical list widgets
 * while their data loads. Shape: a short heading bar followed by `rows`
 * full-width content bars.
 *
 * Accessibility contract (matches established skeleton pattern):
 *   - Outer section: `role="status"` + `aria-label="Loading rail"` +
 *     `aria-busy="true"` → ONE SR announcement per rail region.
 *   - All pulsing primitives: `aria-hidden="true"` → decorative only.
 *
 * Server-component-safe: no 'use client', no hooks.
 */

import { SkeletonText } from './Skeleton'

export interface RailSkeletonProps {
  /** Number of content rows to render below the heading bar. Default 3. */
  rows?: number
}

export function RailSkeleton({ rows = 3 }: RailSkeletonProps = {}) {
  return (
    <section role="status" aria-label="Loading rail" aria-busy="true" className="rail-skeleton">
      {/* Short heading bar — narrower than content rows to suggest a label */}
      <SkeletonText className="!w-2/3 !h-3 mb-3" />

      {/* Content rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonText key={i} className="!w-full mb-2" />
      ))}
    </section>
  )
}

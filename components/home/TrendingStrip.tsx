/**
 * TrendingStrip — mobile-only (<lg) horizontal scrolling variant of the
 * trending rail.
 *
 * Server async component.  Reuses `cachedTrendingTags()` (same data,
 * cache-hot in practice).  Returns null when empty.
 *
 * Hidden at lg+ via `lg:hidden` so it only appears in the single-column
 * mobile layout (below 1024 px) where RightSidebar's TrendingTagsRail is
 * not visible.  The `.trending-strip` selector provides a stable hook for
 * E2E targeting (OPC-5: no paging arrows, OS-default scrollbar).
 *
 * Rendered in `app/page.tsx` above the feed header.
 */

import Link from 'next/link'
import { cachedTrendingTags } from '@/lib/feed/discovery-cache'

export async function TrendingStrip() {
  const tags = await cachedTrendingTags()
  if (tags.length === 0) return null

  return (
    <nav
      aria-label="Trending tags"
      className="trending-strip lg:hidden overflow-x-auto snap-x snap-mandatory"
    >
      <ul role="list" className="trending-strip__list flex gap-2 py-1">
        {tags.map((t) => (
          <li key={t.slug} className="trending-strip__item snap-start shrink-0">
            <Link
              href={`/tag/${t.slug}`}
              className="tag-chip"
            >
              #{t.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

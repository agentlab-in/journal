/**
 * TrendingTagsRail — sidebar rail showing the top 5 trending tags from the
 * last 7 days.
 *
 * Server async component. Awaits `cachedTrendingTags()` (cached 10 min,
 * tag-invalidated on publish/edit/delete). Returns null when the result
 * set is empty so the parent Suspense boundary leaves no empty gap.
 *
 * Rendered inside a `<Suspense fallback={<RailSkeleton rows={5} />}>`
 * wrapper in LeftSidebar (xl) and RightSidebar (lg breakpoint slot).
 */

import Link from 'next/link'
import { cachedTrendingTags } from '@/lib/feed/discovery-cache'
import { RailHeading } from './RailHeading'

export async function TrendingTagsRail(
  { headingId = 'trending-tags-heading' }: { headingId?: string } = {},
) {
  const tags = await cachedTrendingTags()
  if (tags.length === 0) return null

  return (
    <section aria-labelledby={headingId}>
      <RailHeading id={headingId} icon="hash">
        Trending tags
      </RailHeading>
      <ul role="list" className="trending-tags-rail__list">
        {tags.map((t) => (
          <li key={t.slug} className="trending-tags-rail__item">
            <Link
              href={`/tag/${t.slug}`}
              className="trending-tags-rail__link"
            >
              <span className="trending-tags-rail__name">#{t.name}</span>
              <span className="trending-tags-rail__count text-muted">
                {t.count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

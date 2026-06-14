/**
 * FeaturedTagsFallback — static fallback rail shown in RightSidebar when
 * both the top-playbooks and top-dives caches return empty results (e.g.
 * a fresh DB with no recent posts of those types).
 *
 * Reuses `FEATURED_TAG_SLUGS` from `@/lib/search/featured-tags` (OPC-6:
 * single source of truth; this list also drives the /search empty-state
 * chips and the /tags "Featured" grid). Do NOT introduce a duplicate
 * constant here.
 *
 * Server component — no 'use client', no async/await.
 */

import Link from 'next/link'
import { FEATURED_TAG_SLUGS } from '@/lib/search/featured-tags'
import { RailHeading } from './RailHeading'

export function FeaturedTagsFallback() {
  return (
    <section aria-labelledby="starter-topics-heading">
      <RailHeading id="starter-topics-heading" icon="tag">
        Starter topics
      </RailHeading>
      <div className="featured-tags-fallback__chips flex flex-wrap gap-2">
        {FEATURED_TAG_SLUGS.map((slug) => (
          <Link
            key={slug}
            href={`/tag/${slug}`}
            className="tag-chip"
          >
            #{slug}
          </Link>
        ))}
      </div>
    </section>
  )
}

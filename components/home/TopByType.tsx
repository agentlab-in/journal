/**
 * TopByType — sidebar rail showing top posts (playbooks or deep dives)
 * from the last 7 days, ranked by heat-score.
 *
 * Server async component.  Prop `type` selects which cached query to
 * await: `cachedTopPlaybooks` for 'playbook', `cachedTopDives` for 'dive'.
 * Returns null when the result set is empty so the parent Suspense boundary
 * leaves no empty gap.
 *
 * URL construction delegates to `postUrl` from `lib/posts/url` so the
 * `/{leadingSegment}/{type}/{slug}` canonical form is always correct — org
 * posts use the org slug as the leading segment, personal posts use the
 * author username.
 */

import Link from 'next/link'
import { cachedTopPlaybooks, cachedTopDives } from '@/lib/feed/discovery-cache'
import { postUrl } from '@/lib/posts/url'
import type { PostType } from '@/lib/posts/url'

export interface TopByTypeProps {
  type: 'playbook' | 'dive'
  headingId?: string
}

export async function TopByType({ type, headingId }: TopByTypeProps) {
  const resolvedHeadingId = headingId ?? `top-${type}-heading`
  const posts = type === 'playbook'
    ? await cachedTopPlaybooks()
    : await cachedTopDives()

  if (posts.length === 0) return null

  const heading = type === 'playbook'
    ? 'Top playbooks this week'
    : 'Top deep dives this week'

  return (
    <section aria-labelledby={resolvedHeadingId}>
      <h2 id={resolvedHeadingId} className="rail-heading">
        {heading}
      </h2>
      <ul role="list" className="top-by-type__list">
        {posts.map((p) => (
          <li key={p.id} className="top-by-type__item">
            <Link
              href={postUrl(p.leading_segment, type as PostType, p.slug)}
              className="top-by-type__link"
            >
              <span className="top-by-type__title">{p.title}</span>
              <span className="top-by-type__meta text-muted">
                @{p.author_username} · ♥ {p.like_count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

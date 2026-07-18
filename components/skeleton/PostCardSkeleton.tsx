/**
 * Feed-card-shaped skeleton. Matches the rough layout of
 * `components/post/PostCard`:
 *
 *   [avatar] display-name @handle · date    [type-chip]
 *   ─────────────────────────────────────────────────
 *   title (full-width bar)
 *   summary (two short bars)
 *   #tag  #tag
 *
 * Renders `count` cards (default 5) when used as a Suspense fallback for
 * the feed pages. The outer wrapper carries `role="status"` so SR users
 * hear one "Loading posts" announcement regardless of card count.
 */

import { SkeletonText, SkeletonCircle, SkeletonBlock } from './Skeleton'

export interface PostCardSkeletonProps {
  /** Number of placeholder cards to render. Default 5 (feed page-size feel). */
  count?: number
}

function SinglePostCardSkeleton() {
  return (
    <article
      aria-hidden="true"
      className="post-card flex flex-col gap-3 border border-border bg-bg p-4 rounded"
    >
      {/* Header row: avatar + name/handle + date */}
      <header className="flex items-center gap-2">
        <SkeletonCircle size={32} />
        <SkeletonText className="!w-32" />
        <SkeletonText className="!w-16" />
      </header>

      {/* Title */}
      <SkeletonText className="!h-5 !w-3/4" />

      {/* Summary — two short lines */}
      <SkeletonText className="!w-full" />
      <SkeletonText className="!w-5/6" />

      {/* Tags row */}
      <div className="flex gap-2">
        <SkeletonBlock className="h-5 w-16" />
        <SkeletonBlock className="h-5 w-20" />
      </div>
    </article>
  )
}

export function PostCardSkeleton({ count = 5 }: PostCardSkeletonProps = {}) {
  return (
    <ul
      role="status"
      aria-label="Loading posts"
      aria-busy="true"
      className="home-feed__list flex flex-col gap-4 list-none p-0 m-0"
    >
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="home-feed__item">
          <SinglePostCardSkeleton />
        </li>
      ))}
    </ul>
  )
}

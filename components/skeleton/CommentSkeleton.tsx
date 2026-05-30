/**
 * Comment thread item skeleton. Matches one comment row in
 * `components/post/CommentThread`:
 *
 *   [avatar] @handle · time
 *   body line 1
 *   body line 2
 *   body line 3
 *
 * The thread fallback typically renders 3 items — comments aren't
 * paginated and most posts have a handful, so 3 strikes a balance
 * between conveying "list" and not faking a wall of pending content.
 */

import { SkeletonText, SkeletonCircle } from './Skeleton'

export interface CommentSkeletonProps {
  /** Number of placeholder comments. Default 3. */
  count?: number
}

function SingleCommentSkeleton() {
  return (
    <article
      aria-hidden="true"
      className="flex gap-3 border-b border-border py-4 last:border-b-0"
    >
      <SkeletonCircle size={32} />
      <div className="flex-1 flex flex-col gap-2">
        <div className="flex gap-2 items-center">
          <SkeletonText className="!w-24" />
          <SkeletonText className="!w-16" />
        </div>
        <SkeletonText className="!w-full" />
        <SkeletonText className="!w-11/12" />
        <SkeletonText className="!w-2/3" />
      </div>
    </article>
  )
}

export function CommentSkeleton({ count = 3 }: CommentSkeletonProps = {}) {
  return (
    <section
      role="status"
      aria-label="Loading comments"
      aria-busy="true"
      className="comments-section"
    >
      {Array.from({ length: count }).map((_, i) => (
        <SingleCommentSkeleton key={i} />
      ))}
    </section>
  )
}

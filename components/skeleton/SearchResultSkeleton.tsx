/**
 * Search-result-row skeleton. Matches `SearchResultItem` in
 * `app/search/page.tsx`:
 *
 *   [Type] · author · date
 *   title
 *   snippet line 1
 *   snippet line 2
 */

import { SkeletonText } from './Skeleton'

export interface SearchResultSkeletonProps {
  /** Number of placeholder rows. Default 5. */
  count?: number
}

function SingleSearchResultSkeleton() {
  return (
    <li aria-hidden="true" className="search-page__item flex flex-col gap-2 py-4">
      <div className="flex gap-2">
        <SkeletonText className="!w-12" />
        <SkeletonText className="!w-24" />
        <SkeletonText className="!w-20" />
      </div>
      <SkeletonText className="!h-5 !w-3/4" />
      <SkeletonText className="!w-full" />
      <SkeletonText className="!w-5/6" />
    </li>
  )
}

export function SearchResultSkeleton({ count = 5 }: SearchResultSkeletonProps = {}) {
  return (
    <ul
      role="status"
      aria-label="Loading search results"
      aria-busy="true"
      className="search-page__results list-none p-0 m-0"
    >
      {Array.from({ length: count }).map((_, i) => (
        <SingleSearchResultSkeleton key={i} />
      ))}
    </ul>
  )
}

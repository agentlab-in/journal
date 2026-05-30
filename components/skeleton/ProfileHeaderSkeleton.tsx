/**
 * Profile-header-shaped skeleton. Matches the layout of
 * `components/profile/ProfileHeader`:
 *
 *   [96px avatar]   display-name           [Follow ]
 *                   @handle
 *
 *   bio line 1
 *   bio line 2
 *
 *   N followers · N following · GitHub · Joined …
 *
 * Renders one instance (profile headers are singular). The wrapping
 * `role="status"` lets a SR user know the profile is loading without
 * enumerating each pulsing strip.
 */

import { SkeletonText, SkeletonCircle, SkeletonBlock } from './Skeleton'

export function ProfileHeaderSkeleton() {
  return (
    <header
      role="status"
      aria-label="Loading profile"
      aria-busy="true"
      className="profile-header flex flex-col gap-4 py-6"
    >
      <div className="flex items-center gap-4">
        <SkeletonCircle size={96} />
        <div className="flex-1 flex flex-col gap-2">
          <SkeletonText className="!h-6 !w-48" />
          <SkeletonText className="!w-32" />
        </div>
        <SkeletonBlock className="h-9 w-24" />
      </div>

      {/* Bio (two lines) */}
      <SkeletonText className="!w-full" />
      <SkeletonText className="!w-4/5" />

      {/* Meta row */}
      <div className="flex gap-3">
        <SkeletonText className="!w-24" />
        <SkeletonText className="!w-24" />
        <SkeletonText className="!w-20" />
      </div>
    </header>
  )
}

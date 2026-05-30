import Link from 'next/link'
import { FollowButton } from './FollowButton'
import { ReportButton } from '@/components/report/ReportButton'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { MdxFailedFallback } from '@/components/error/MdxFailedFallback'

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
})

function formatJoined(iso: string): string {
  return DATE_FMT.format(new Date(iso))
}

export interface ProfileHeaderProps {
  username: string
  displayName: string
  avatarUrl: string | null
  bioHtml: string | null
  createdAt: string
  /**
   * Original-case GitHub login mirrored from next_auth.users. Preferred for
   * the external GitHub link so we preserve casing for any future display /
   * copy-to-clipboard surface. Falls back to `username` when null (defensive
   * — older rows may not have been re-synced yet).
   */
  githubLogin: string | null
  isOwner: boolean
  /** users.id of the profile being viewed; passed through to FollowButton. */
  targetUserId: string
  followerCount: number
  followingCount: number
  /**
   * Whether the viewer already follows this profile. Server-resolved; the
   * FollowButton seeds its own optimistic state from this. Always `false`
   * for anon / self per `getFollowState`.
   */
  initialFollowing: boolean
  /**
   * Path of the page rendering this header — forwarded to FollowButton as
   * the callbackUrl when an anon viewer clicks Follow.
   */
  currentPath: string
  /** Whether the viewer has an authenticated session. */
  isSignedIn: boolean
}

export function ProfileHeader({
  username,
  displayName,
  avatarUrl,
  bioHtml,
  createdAt,
  githubLogin,
  isOwner,
  targetUserId,
  followerCount,
  followingCount,
  initialFollowing,
  currentPath,
  isSignedIn,
}: ProfileHeaderProps) {
  const githubHandle = githubLogin ?? username
  return (
    <header className="profile-header">
      <div className="profile-header__top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl ?? '/icon.png'}
          alt=""
          className="profile-avatar"
          width={96}
          height={96}
        />
        <div className="profile-header__identity">
          <h1 className="profile-display-name">{displayName}</h1>
          <p className="profile-handle">@{username}</p>
        </div>
        <div className="profile-header__actions">
          {isOwner ? (
            <Link href="/settings/profile" className="profile-edit-link">
              Edit Profile
            </Link>
          ) : (
            <>
              <FollowButton
                targetUserId={targetUserId}
                username={username}
                initialFollowing={initialFollowing}
                isSignedIn={isSignedIn}
                currentPath={currentPath}
              />
              <ReportButton
                targetType="user"
                targetId={targetUserId}
                isSignedIn={isSignedIn}
                currentPath={currentPath}
                isSelf={isOwner}
              />
            </>
          )}
        </div>
      </div>

      {bioHtml && (
        // Narrow boundary around the rendered bio HTML — a malformed
        // payload shouldn't take down the rest of the profile header.
        <ErrorBoundary
          resetKey={bioHtml}
          fallback={<MdxFailedFallback context="bio" />}
        >
          <div
            className="profile-bio"
            dangerouslySetInnerHTML={{ __html: bioHtml }}
          />
        </ErrorBoundary>
      )}

      <div className="profile-meta">
        <Link href={`/${username}/followers`} className="profile-follow-count">
          <strong>{followerCount}</strong>{' '}
          {followerCount === 1 ? 'follower' : 'followers'}
        </Link>
        <span aria-hidden="true">·</span>
        <Link href={`/${username}/following`} className="profile-follow-count">
          <strong>{followingCount}</strong> following
        </Link>
        <span aria-hidden="true">·</span>
        <a
          href={`https://github.com/${githubHandle}`}
          target="_blank"
          rel="noopener noreferrer"
          className="profile-github-link"
        >
          GitHub
        </a>
        <span className="profile-joined">
          Joined <time dateTime={createdAt}>{formatJoined(createdAt)}</time>
        </span>
      </div>
    </header>
  )
}

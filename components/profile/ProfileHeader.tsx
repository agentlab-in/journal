import Image from 'next/image'
import Link from 'next/link'
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
  /** users.id of the profile being viewed; passed through to ReportButton. */
  targetUserId: string
  /**
   * Path of the page rendering this header — forwarded to ReportButton as
   * the callbackUrl when an anon viewer opens the report flow.
   */
  currentPath: string
  /** Whether the viewer has an authenticated session. */
  isSignedIn: boolean
}

/**
 * Sidebar component for the user profile page. Renders identity (avatar,
 * display name, handle, bio), the primary owner/viewer action (Edit Profile
 * vs Report), followed by the GitHub/joined meta row. Lives in an `<aside>`
 * so the surrounding `<main>` is the only main landmark.
 */
export function ProfileHeader({
  username,
  displayName,
  avatarUrl,
  bioHtml,
  createdAt,
  githubLogin,
  isOwner,
  targetUserId,
  currentPath,
  isSignedIn,
}: ProfileHeaderProps) {
  const githubHandle = githubLogin ?? username
  return (
    <aside className="profile-sidebar" aria-label="Profile">
      <Image
        src={avatarUrl ?? '/icon.png'}
        alt=""
        className="profile-avatar"
        width={256}
        height={256}
        priority
      />

      <div className="profile-sidebar__identity">
        <h1 className="profile-display-name">{displayName}</h1>
        <p className="profile-handle">@{username}</p>
      </div>

      {bioHtml && (
        // Narrow boundary around the rendered bio HTML — a malformed
        // payload shouldn't take down the rest of the profile sidebar.
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

      <div className="profile-sidebar__actions">
        {isOwner ? (
          <Link href="/settings/profile" className="profile-edit-link">
            Edit Profile
          </Link>
        ) : (
          <ReportButton
            targetType="user"
            targetId={targetUserId}
            isSignedIn={isSignedIn}
            currentPath={currentPath}
            isSelf={isOwner}
          />
        )}
      </div>

      <div className="profile-sidebar__meta">
        <a
          href={`https://github.com/${githubHandle}`}
          target="_blank"
          rel="noopener noreferrer"
          className="profile-github-link"
          aria-label={`${displayName} on GitHub`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            className="profile-github-link__icon"
          >
            <path
              fill="currentColor"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"
            />
          </svg>
          <span>{githubHandle}</span>
        </a>
        <span className="profile-joined">
          Joined <time dateTime={createdAt}>{formatJoined(createdAt)}</time>
        </span>
      </div>
    </aside>
  )
}

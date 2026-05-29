import Link from 'next/link'
import { FollowButton } from './FollowButton'

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
  isOwner: boolean
}

export function ProfileHeader({
  username,
  displayName,
  avatarUrl,
  bioHtml,
  createdAt,
  isOwner,
}: ProfileHeaderProps) {
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
            <FollowButton />
          )}
        </div>
      </div>

      {bioHtml && (
        <div
          className="profile-bio"
          dangerouslySetInnerHTML={{ __html: bioHtml }}
        />
      )}

      <div className="profile-meta">
        <a
          href={`https://github.com/${username}`}
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

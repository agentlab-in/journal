import Image from 'next/image'
import Link from 'next/link'

export interface UserCardProps {
  username: string
  displayName: string
  avatarUrl: string | null
  /**
   * Plain-text bio preview. Markdown is intentionally NOT rendered here —
   * a follower/following list packs many cards onto one screen, and rendered
   * markdown would introduce inconsistent line-heights and link styles per
   * row. Pass the raw bio (already truncated by the caller if needed).
   */
  bio: string | null
}

const BIO_MAX = 200

function truncateBio(bio: string | null): string | null {
  if (!bio) return null
  const trimmed = bio.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length <= BIO_MAX) return trimmed
  return trimmed.slice(0, BIO_MAX - 1).trimEnd() + '…'
}

export function UserCard({ username, displayName, avatarUrl, bio }: UserCardProps) {
  const preview = truncateBio(bio)
  return (
    <Link href={`/${username}`} className="user-card">
      <Image
        src={avatarUrl ?? '/icon.png'}
        alt=""
        className="user-card__avatar"
        width={48}
        height={48}
      />
      <div className="user-card__body">
        <div className="user-card__identity">
          <span className="user-card__display-name">{displayName}</span>
          <span className="user-card__handle">@{username}</span>
        </div>
        {preview && <p className="user-card__bio">{preview}</p>}
      </div>
    </Link>
  )
}

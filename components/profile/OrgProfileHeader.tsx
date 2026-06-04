import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { MdxFailedFallback } from '@/components/error/MdxFailedFallback'

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
})

function formatJoined(iso: string): string {
  return DATE_FMT.format(new Date(iso))
}

export interface OrgProfileHeaderProps {
  slug: string
  displayName: string
  avatarUrl: string | null
  coverImageUrl: string | null
  bioHtml: string | null
  createdAt: string
}

/**
 * Org variant of the profile header. Intentionally narrower than the
 * user `ProfileHeader`:
 *   - No follow/report viewer actions (Phase 11: orgs are not followable
 *     and the Report-org affordance lives elsewhere when it ships).
 *   - No "Edit Profile" owner link — org profile is read-only and sourced
 *     from GitHub (display_name, bio, avatar all sync on sign-in).
 *   - Cover image renders when present; mirrors user cover handling.
 */
export function OrgProfileHeader({
  slug,
  displayName,
  avatarUrl,
  coverImageUrl,
  bioHtml,
  createdAt,
}: OrgProfileHeaderProps) {
  return (
    <header className="profile-header profile-header--org">
      {coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverImageUrl}
          alt=""
          className="profile-cover"
        />
      )}
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
          <p className="profile-handle">@{slug}</p>
          <p className="profile-org-badge" aria-label="Organization">
            Organization
          </p>
        </div>
      </div>

      {bioHtml && (
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
        <span className="profile-joined">
          Created <time dateTime={createdAt}>{formatJoined(createdAt)}</time>
        </span>
      </div>
    </header>
  )
}

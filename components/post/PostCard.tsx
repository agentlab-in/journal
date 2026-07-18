import Link from 'next/link'
import { postUrl } from '@/lib/posts/url'
import type { PostType } from '@/lib/posts/url'

/**
 * Feed-surface PostCard.
 *
 * Used by the homepage feed, /latest, /tag/<slug>, and /search. Includes
 * the author chip that feed surfaces want, but intentionally has *no*
 * pin/owner-only action slot: that lives on
 * `components/profile/ProfilePostCard`, which feeds the profile surface.
 * The two are kept separate on purpose; consolidating them would cascade
 * through ProfilePage / BookmarksPage / PinnedPosts / PostList.
 *
 * This is a server component (no `'use client'`) — purely presentational.
 */

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

function formatDate(iso: string): string {
  return DATE_FMT.format(new Date(iso))
}

export interface PostCardData {
  id: string
  type: PostType
  slug: string
  title: string
  summary: string
  published_at: string
  author: {
    username: string
    display_name: string
    avatar_url: string | null
  }
  /**
   * Set when the post was published under an org (Phase 11). When present,
   * the byline reads `{org.display_name} via @{author.username}` and the
   * card link uses the org's vanity slug as the leading URL segment.
   */
  org?: { display_name: string; slug: string } | null
  /** Already filtered to approved tags, capped to top 2 by the caller. */
  tags: Array<{ slug: string; name: string }>
}

export interface PostCardProps {
  post: PostCardData
}

export function PostCard({ post }: PostCardProps) {
  const { author, org } = post
  // Defense-in-depth: usernames are DB-validated to a strict regex, but
  // encoding here makes PostCard safe against any future loosening of the
  // schema or a fixture that hand-rolls a PostCardData.
  const profileHref = `/${encodeURIComponent(author.username)}`
  const orgHref = org ? `/${encodeURIComponent(org.slug)}` : null
  const initial = (org?.display_name ?? author.display_name)
    .trim()
    .charAt(0)
    .toUpperCase() || '?'
  // Leading segment in the post URL matches what the publish API generates —
  // org slug for org-authored posts, author username otherwise (T3/T4).
  const cardHref = postUrl(org?.slug ?? author.username, post.type, post.slug)

  return (
    // `data-feed-card` + `data-href` opt this card into the j/k/Enter
    // keyboard nav (see <KeyboardFeedNav />). `tabIndex={-1}` keeps the
    // card out of the normal Tab order — it only gains focus via the
    // wrapper's programmatic focus() call.
    <article
      className="post-card"
      data-feed-card
      data-href={cardHref}
      tabIndex={-1}
    >
      <header className="post-card__header">
        <Link href={profileHref} className="post-card__avatar-link" aria-label={author.display_name}>
          {author.avatar_url ? (
            // Avatars currently come from GitHub (configured in next.config.ts)
            // but other auth providers are on the roadmap, so we stay on
            // <img> + lazy-load to avoid coupling the feed to a fixed
            // remotePatterns list. Matches the convention in ProfileHeader.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={author.avatar_url}
              alt={author.display_name}
              width={32}
              height={32}
              loading="lazy"
              className="post-card__avatar"
            />
          ) : (
            <span aria-hidden="true" className="post-card__avatar post-card__avatar--fallback">
              {initial}
            </span>
          )}
        </Link>
        <div className="post-card__identity">
          {org && orgHref ? (
            // Org-authored: lead with the org display_name, link it to the
            // org profile, then attribute the human author by handle.
            <>
              <Link href={orgHref} className="post-card__display-name">
                {org.display_name}
              </Link>{' '}
              <span className="post-card__via">via</span>{' '}
              <Link href={profileHref} className="post-card__handle">
                @{author.username}
              </Link>
            </>
          ) : (
            <>
              <Link href={profileHref} className="post-card__display-name">
                {author.display_name}
              </Link>{' '}
              <Link href={profileHref} className="post-card__handle">
                @{author.username}
              </Link>
            </>
          )}
        </div>
        <span aria-hidden="true" className="post-card__sep">·</span>
        <time dateTime={post.published_at} className="post-card__date">
          {formatDate(post.published_at)}
        </time>
        <span className={`type-chip type-chip--${post.type} post-card__type`}>{post.type}</span>
      </header>

      {/* h2 (not h3) so the document outline goes h1 (page title) → h2
          (card title) without skipping a level — axe heading-order. */}
      <h2 className="post-card__title">
        <Link href={cardHref}>{post.title}</Link>
      </h2>

      {post.summary && <p className="post-card__summary">{post.summary}</p>}

      {post.tags.length > 0 && (
        <ul className="post-card__tags">
          {post.tags.slice(0, 2).map((t) => (
            <li key={t.slug}>
              <Link href={`/tag/${encodeURIComponent(t.slug)}`} className="tag-chip">
                #{t.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

'use client'

import Link from 'next/link'
import { postUrl } from '@/lib/posts/url'
import type { PostType } from '@/lib/posts/url'

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

function formatDate(iso: string): string {
  return DATE_FMT.format(new Date(iso))
}

export interface ProfilePostCardData {
  id: string
  type: PostType
  slug: string
  title: string
  summary: string
  cover_image_url: string | null
  published_at: string
  view_count: number
  tags: Array<{ slug: string; name: string; is_approved: boolean }>
}

export interface ProfilePostCardProps {
  username: string
  post: ProfilePostCardData
  /** Optional owner-only action button (Pin / Unpin) rendered in the corner. */
  action?: React.ReactNode
}

export function ProfilePostCard({ username, post, action }: ProfilePostCardProps) {
  return (
    <article className="profile-post-card">
      <div className="profile-post-card__header">
        <span className={`type-chip type-chip--${post.type}`}>{post.type}</span>
        {action && <div className="profile-post-card__action">{action}</div>}
      </div>
      <h3 className="profile-post-card__title">
        <Link href={postUrl(username, post.type, post.slug)}>{post.title}</Link>
      </h3>
      {post.summary && <p className="profile-post-card__summary">{post.summary}</p>}
      {post.tags.length > 0 && (
        <ul className="profile-post-card__tags">
          {post.tags.map((t) => (
            <li key={t.slug}>
              <Link
                href={`/tag/${t.slug}`}
                className={t.is_approved ? 'tag-chip' : 'tag-chip tag-pending'}
              >
                #{t.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="profile-post-card__meta">
        <time dateTime={post.published_at}>{formatDate(post.published_at)}</time>
        <span aria-hidden="true"> · </span>
        <span>{post.view_count} views</span>
      </div>
    </article>
  )
}

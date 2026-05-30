import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getSession, resolveIsAdmin } from '@/lib/auth'
import { getCachedPost } from '@/lib/posts/lookup'
import { getEngagementState } from '@/lib/posts/engagement'
import { postUrl } from '@/lib/posts/url'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { PostBody } from '@/components/posts/PostBody'
import { StructuredSections } from '@/components/posts/StructuredSections'
import { ViewBeacon } from '@/components/posts/ViewBeacon'
import { AuthorActions } from '@/components/posts/AuthorActions'
import { Backlinks } from '@/components/posts/Backlinks'
import { CommentsSection } from '@/components/post/CommentsSection'
import { LikeButton } from '@/components/post/LikeButton'
import { BookmarkButton } from '@/components/post/BookmarkButton'

interface PageParams {
  username: string
  type: string
  slug: string
}

// Pin a locale so SSR + client render the same string and React doesn't
// emit a hydration mismatch when the server and viewer locales differ.
const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

function formatDate(iso: string): string {
  return DATE_FMT.format(new Date(iso))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>
}): Promise<Metadata> {
  const { username, type, slug } = await params
  const post = await getCachedPost({ username, type, slug })

  if (!post) {
    return { title: 'Not found' }
  }

  const canonicalPath = postUrl(post.author.username, post.type, post.slug)

  return {
    title: `${post.title} — ${post.author.display_name}`,
    description: post.summary,
    openGraph: {
      title: post.title,
      description: post.summary,
      url: canonicalPath,
      images: post.cover_image_url ? [{ url: post.cover_image_url }] : [{ url: '/og.png' }],
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.summary,
      images: post.cover_image_url ? [post.cover_image_url] : ['/og.png'],
    },
    alternates: { canonical: canonicalPath },
  }
}

export default async function PostPage({
  params,
}: {
  params: Promise<PageParams>
}) {
  const { username, type, slug } = await params

  const post = await getCachedPost({ username, type, slug })

  if (post == null) {
    notFound()
  }

  const session = await getSession()
  const isOwner = session?.user?.id === post.author_id
  const isSignedIn = !!session?.user?.id

  // Admin check: if signed in but not owner, resolve via helper
  let isAdminUser = false
  if (session?.user?.id && !isOwner) {
    isAdminUser = await resolveIsAdmin(session.user.id)
  }

  // Resolve viewer's like + bookmark state for this post. Anon viewers
  // short-circuit to {false,false} without touching the DB.
  const engagement = await getEngagementState({
    admin: createAdminSupabaseClient(),
    postId: post.id,
    userId: session?.user?.id,
  })

  const canonicalPath = postUrl(post.author.username, post.type, post.slug)

  return (
    <article className="post-page">
      {post.cover_image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.cover_image_url} alt="" className="post-cover" />
      )}
      <header className="post-header">
        <h1>{post.title}</h1>
        <p className="post-summary">{post.summary}</p>
        <div className="post-author">
          {post.author.avatar_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.author.avatar_url} alt="" className="author-avatar" />
          )}
          <Link href={`/${post.author.username}`} className="author-handle">
            @{post.author.username}
          </Link>
          <span className="author-display">{post.author.display_name}</span>
          <button type="button" className="follow-stub" disabled aria-disabled>
            Follow
          </button>
        </div>
        {post.tags.length > 0 && (
          <ul className="post-tags">
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
        <div className="post-meta">
          <time dateTime={post.published_at}>{formatDate(post.published_at)}</time>
          {post.edited_at && (
            <>
              {' · '}
              <span>Edited {formatDate(post.edited_at)}</span>
            </>
          )}
          <span aria-hidden="true"> · </span>
          <span>
            {post.comment_count}{' '}
            {post.comment_count === 1 ? 'comment' : 'comments'}
          </span>
          <span aria-hidden="true"> · </span>
          <LikeButton
            postId={post.id}
            initialLiked={engagement.liked}
            initialCount={post.like_count}
            isSignedIn={isSignedIn}
            currentPath={canonicalPath}
          />
          <BookmarkButton
            postId={post.id}
            initialBookmarked={engagement.bookmarked}
            isSignedIn={isSignedIn}
            currentPath={canonicalPath}
          />
        </div>
        {(isOwner || isAdminUser) && <AuthorActions postId={post.id} />}
      </header>

      <StructuredSections type={post.type} sections={post.structured_sections} />

      <PostBody html={post.body_html} />

      <Backlinks postId={post.id} />

      <CommentsSection postId={post.id} />

      <ViewBeacon postId={post.id} />
    </article>
  )
}

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getSession, resolveIsAdmin } from '@/lib/auth'
import { getCachedPost } from '@/lib/posts/lookup'
import { postUrl } from '@/lib/posts/url'
import { PostBody } from '@/components/posts/PostBody'
import { StructuredSections } from '@/components/posts/StructuredSections'
import { ViewBeacon } from '@/components/posts/ViewBeacon'
import { AuthorActions } from '@/components/posts/AuthorActions'
import { Backlinks } from '@/components/posts/Backlinks'

interface PageParams {
  username: string
  type: string
  slug: string
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

  // Admin check: if signed in but not owner, resolve via helper
  let isAdminUser = false
  if (session?.user?.id && !isOwner) {
    isAdminUser = await resolveIsAdmin(session.user.id)
  }

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
          <time dateTime={post.published_at}>
            {new Date(post.published_at).toLocaleDateString()}
          </time>
          {post.edited_at && (
            <>
              {' · '}
              <span>Edited {new Date(post.edited_at).toLocaleDateString()}</span>
            </>
          )}
        </div>
        {(isOwner || isAdminUser) && <AuthorActions postId={post.id} />}
      </header>

      <StructuredSections type={post.type} sections={post.structured_sections} />

      <PostBody html={post.body_html} />

      <Backlinks postId={post.id} />

      <ViewBeacon postId={post.id} />
    </article>
  )
}

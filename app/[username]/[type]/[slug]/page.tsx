import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { getSession, resolveIsAdmin } from '@/lib/auth'
import { getCachedPost } from '@/lib/posts/lookup'
import { getEngagementState } from '@/lib/posts/engagement'
import { postUrl } from '@/lib/posts/url'
import { hasMermaid } from '@/lib/posts/has-mermaid'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { PostBodyStatic } from '@/components/posts/PostBodyStatic'
import { StructuredSections } from '@/components/posts/StructuredSections'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { MdxFailedFallback } from '@/components/error/MdxFailedFallback'
import { ViewBeacon } from '@/components/posts/ViewBeacon'
import { AuthorActions } from '@/components/posts/AuthorActions'
import { Backlinks } from '@/components/posts/Backlinks'
import { CommentsSection } from '@/components/post/CommentsSection'
import { LikeButton } from '@/components/post/LikeButton'
import { BookmarkButton } from '@/components/post/BookmarkButton'
import { FollowButton } from '@/components/profile/FollowButton'
import { getFollowState } from '@/lib/profile/follow-state'
import { ReportButton } from '@/components/report/ReportButton'
import { CommentSkeleton } from '@/components/skeleton/CommentSkeleton'
import { logRouteError } from '@/lib/logging/error-log'

// Posts above this size trigger a WARN log when rendered. The page still
// serves — this is a signal to investigate the post (and eventually
// enforce a hard cap at write-time) rather than a runtime block. 500 KB
// of HTML is already an extreme outlier: a typical long-form post body
// fits in ~30-80 KB.
const BODY_HTML_WARN_BYTES = 500_000

// Code-split the client `<PostBody>` (whose useEffect lazy-imports
// `mermaid` on mount). Defined at module scope per react-hooks rules —
// recreating the dynamic wrapper on every render would defeat chunk
// caching and trip `react-hooks/static-components`. We keep SSR on
// (default) so the body HTML still server-renders for SEO/FCP on
// mermaid pages; the win is that the PostBody chunk + the
// mermaid-init module are only included in the bundle graph of pages
// whose tree actually contains `<PostBodyDynamic>` (i.e. mermaid pages).
// Non-mermaid posts render `<PostBodyStatic>` and ship zero client JS
// for the body region.
const PostBodyDynamic = dynamic(() =>
  import('@/components/posts/PostBody').then((m) => ({ default: m.PostBody })),
)

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
    // Bypasses the layout-level template; rendered title is just "Not found".
    return { title: { absolute: 'Not found — agentlab.in' } }
  }

  const canonicalPath = postUrl(post.author.username, post.type, post.slug)

  return {
    // `title.absolute` bypasses the layout-level `'%s — agentlab.in'`
    // template — without it we'd get
    // `"<title> — <author> — agentlab.in"` from the template plus the
    // author suffix, which is awkward. Author byline lives in the
    // body header where it's discoverable.
    title: { absolute: `${post.title} — agentlab.in` },
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

  const admin = createAdminSupabaseClient()
  const [engagement, viewerFollowsAuthor] = await Promise.all([
    getEngagementState({ admin, postId: post.id, userId: session?.user?.id }),
    getFollowState({
      admin,
      targetUserId: post.author_id,
      viewerUserId: session?.user?.id ?? null,
    }),
  ])

  const canonicalPath = postUrl(post.author.username, post.type, post.slug)

  // WARN (don't block) when body_html is unexpectedly large. Logged on
  // every viewer render so the spike is visible exactly when it bites.
  // The author flow should eventually grow a hard cap; until then this
  // is the cheapest early-warning system.
  if (post.body_html.length > BODY_HTML_WARN_BYTES) {
    logRouteError(new Error('oversized_body_html'), {
      route: '/posts/render',
      extra: {
        post_id: post.id,
        byte_length: post.body_html.length,
      },
    })
  }

  // Server-side detect: only mount the client `<PostBody>` (which pulls
  // in mermaid on mount) on posts that actually contain a Mermaid block.
  // Everything else gets `<PostBodyStatic>` with zero client JS for the
  // body region.
  const postHasMermaid = hasMermaid(post.body_html)

  return (
    <main id="main-content">
      <article className="post-page">
      {post.cover_image_url && (
        // Cover image is a decorative banner — empty alt is correct
        // (title + summary already carry the semantic load). Sized
        // 1280×640 matches the OG-image aspect ratio our covers are
        // produced at; CSS (.post-cover) constrains to width:100% and
        // max-height:420px, so this is just the intrinsic aspect hint
        // next/image needs to reserve layout space and avoid CLS.
        <Image
          src={post.cover_image_url}
          alt=""
          className="post-cover"
          width={1280}
          height={640}
          priority
          sizes="(max-width: 768px) 100vw, 720px"
        />
      )}
      <header className="post-header">
        <h1>{post.title}</h1>
        <p className="post-summary">{post.summary}</p>
        <div className="post-author">
          {post.author.avatar_url && (
            // .author-avatar pins to 32×32 — render at 2x so the bitmap
            // is crisp on retina. next/image will down-scale via
            // width/height attrs.
            <Image
              src={post.author.avatar_url}
              alt=""
              className="author-avatar"
              width={64}
              height={64}
            />
          )}
          <Link href={`/${post.author.username}`} className="author-handle">
            @{post.author.username}
          </Link>
          <span className="author-display">{post.author.display_name}</span>
          {!isOwner && (
            <FollowButton
              targetUserId={post.author_id}
              username={post.author.username}
              initialFollowing={viewerFollowsAuthor}
              isSignedIn={isSignedIn}
              currentPath={canonicalPath}
            />
          )}
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
          {!isOwner && (
            <ReportButton
              targetType="post"
              targetId={post.id}
              isSignedIn={isSignedIn}
              currentPath={canonicalPath}
              isSelf={isOwner}
            />
          )}
        </div>
        {(isOwner || isAdminUser) && <AuthorActions postId={post.id} />}
      </header>

      <StructuredSections type={post.type} sections={post.structured_sections} />

      {/* Narrow boundary around the post body MDX render — a broken
          dangerouslySetInnerHTML payload or a mermaid hydration failure
          should degrade to a small inline notice instead of bubbling
          up to the route-level error page.

          Two branches:
          - Mermaid present → dynamic-import the client `<PostBody>` so
            its bundle (which lazy-imports mermaid on mount) only loads
            on posts that need it. The `loading` fallback paints
            `<PostBodyStatic>` immediately so SSR + first paint show
            the body without waiting on the chunk.
          - Mermaid absent → render the zero-JS `<PostBodyStatic>`
            directly. The mermaid hydration code never reaches the
            browser. */}
      <ErrorBoundary
        resetKey={post.body_html}
        fallback={<MdxFailedFallback context="post body" />}
      >
        {postHasMermaid ? (
          <PostBodyDynamic html={post.body_html} />
        ) : (
          <PostBodyStatic html={post.body_html} />
        )}
      </ErrorBoundary>

      <Backlinks postId={post.id} />

      {/* Comments are the expensive thread walk on this page — a
          service-role read of every comment row + author join. Stream
          them in under a `CommentSkeleton` fallback so the post body
          (already in DOM) paints first and the page is scrollable
          before comments resolve. */}
      <Suspense fallback={<CommentSkeleton count={3} />}>
        <CommentsSection postId={post.id} />
      </Suspense>

      <ViewBeacon postId={post.id} />
      </article>
    </main>
  )
}

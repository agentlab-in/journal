import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { getSession, resolveIsAdmin } from '@/lib/auth'
import { getCachedPost } from '@/lib/posts/lookup'
import { postUrl } from '@/lib/posts/url'
import { hasMermaid } from '@/lib/posts/has-mermaid'
import { articleJsonLd } from '@/lib/json-ld'
import { PostBodyStatic } from '@/components/posts/PostBodyStatic'
import { MermaidHydratorClient } from '@/components/posts/MermaidHydratorClient'
import { StructuredSections } from '@/components/posts/StructuredSections'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { MdxFailedFallback } from '@/components/error/MdxFailedFallback'
import { AuthorActions } from '@/components/posts/AuthorActions'
import { Backlinks } from '@/components/posts/Backlinks'
import { ReportButton } from '@/components/report/ReportButton'
import { logRouteError } from '@/lib/logging/error-log'
// Home discovery rails — the read page reuses the exact same three-column
// shell as `/` (issue #70). Left nav only on the left; TopByType +
// featured-tags fallback consolidated on the right. Same
// `unstable_cache`-backed data (#54); no new caching layers.
import { HomeShell } from '@/components/home/HomeShell'
import { LeftSidebar } from '@/components/home/LeftSidebar'
import { RightSidebar } from '@/components/home/RightSidebar'
import { TopByType } from '@/components/home/TopByType'
import { RailSkeleton } from '@/components/skeleton/RailSkeleton'

// Posts above this size trigger a WARN log when rendered. The page still
// serves — this is a signal to investigate the post (and eventually
// enforce a hard cap at write-time) rather than a runtime block. 500 KB
// of HTML is already an extreme outlier: a typical long-form post body
// fits in ~30-80 KB.
const BODY_HTML_WARN_BYTES = 500_000

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

  // Org-authored posts canonicalize under the org slug; personal posts
  // under the author username.
  const leadingSegment = post.org ? post.org.slug : post.author.username
  const canonicalPath = postUrl(leadingSegment, post.type, post.slug)

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

  const leadingSegment = post.org ? post.org.slug : post.author.username
  const canonicalPath = postUrl(leadingSegment, post.type, post.slug)

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

  // Server-side detect: only mount the client `<MermaidHydratorClient>`
  // (which dynamic-imports mermaid on mount) on posts that actually
  // contain a Mermaid block. Every post renders `<PostBodyStatic>`
  // (zero client JS for the body region) — mermaid pages additionally
  // mount the hydrator which mutates the static HTML in place.
  const postHasMermaid = hasMermaid(post.body_html)

  // Build the Article (or TechArticle for dives) JSON-LD off the
  // already-fetched post — no extra DB roundtrip. Rendered server-side
  // as the first child of <article> so crawlers see it in the SSR HTML.
  const jsonLd = articleJsonLd({
    type: post.type,
    title: post.title,
    summary: post.summary,
    coverImageUrl: post.cover_image_url,
    publishedAt: post.published_at,
    editedAt: post.edited_at,
    canonicalPath,
    authorName: post.author.display_name,
    authorUsername: post.author.username,
    // Org-authored posts emit publisher = Organization with the org's
    // own url + logo instead of the generic agentlab.in publisher.
    org: post.org
      ? {
          slug: post.org.slug,
          displayName: post.org.display_name,
          avatarUrl: post.org.avatar_url,
        }
      : null,
  })

  return (
    <HomeShell
      left={<LeftSidebar />}
      center={
        <main id="main-content">
          <article className="post-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
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
        {post.org ? (
          // Org-authored post: org-prominent byline. Avatar + handle +
          // display_name belong to the org; the human author rides
          // secondary as "by @author".
          <div className="post-author post-author--org">
            {post.org.avatar_url && (
              <Image
                src={post.org.avatar_url}
                alt=""
                className="author-avatar"
                width={64}
                height={64}
                sizes="32px"
              />
            )}
            <Link href={`/${post.org.slug}`} className="author-handle">
              @{post.org.slug}
            </Link>
            <span className="author-display">{post.org.display_name}</span>
            <span className="post-author-byline">
              by{' '}
              <Link href={`/${post.author.username}`} className="author-handle author-handle--secondary">
                @{post.author.username}
              </Link>
            </span>
          </div>
        ) : (
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
                sizes="32px"
              />
            )}
            <Link href={`/${post.author.username}`} className="author-handle">
              @{post.author.username}
            </Link>
            <span className="author-display">{post.author.display_name}</span>
          </div>
        )}
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
          {!isOwner && (
            <>
              <span aria-hidden="true"> · </span>
              <ReportButton
                targetType="post"
                targetId={post.id}
                isSignedIn={isSignedIn}
                currentPath={canonicalPath}
                isSelf={isOwner}
              />
            </>
          )}
        </div>
        {(isOwner || isAdminUser) && <AuthorActions postId={post.id} />}
      </header>

      <StructuredSections type={post.type} sections={post.structured_sections} />

      {/* Narrow boundary around the post body MDX render — a broken
          dangerouslySetInnerHTML payload or a mermaid hydration failure
          should degrade to a small inline notice instead of bubbling
          up to the route-level error page.

          The static HTML always renders server-side (zero client JS for
          the body region). Mermaid pages additionally mount
          `<MermaidHydratorClient>`, which dynamic-imports the hydrator
          (and via it the `mermaid` library) so neither chunk ships to
          non-mermaid posts. */}
      <ErrorBoundary
        resetKey={post.body_html}
        fallback={<MdxFailedFallback context="post body" />}
      >
        <PostBodyStatic html={post.body_html} />
        {postHasMermaid && <MermaidHydratorClient scopeId={post.id} />}
      </ErrorBoundary>

      <Backlinks postId={post.id} />
      </article>
          {/* Mobile-only (<lg) discovery rails below the post. The right
              sidebar is hidden at <lg, so surface the same TopByType rails
              here. Distinct headingIds avoid duplicate-id-aria with the
              RightSidebar copies that stay in the DOM (hidden) at >=lg. */}
          <div className="post-page__mobile-rails lg:hidden">
            <Suspense fallback={<RailSkeleton rows={3} />}>
              <TopByType type="playbook" headingId="top-playbook-heading-mobile" />
            </Suspense>
            <Suspense fallback={<RailSkeleton rows={3} />}>
              <TopByType type="dive" headingId="top-dive-heading-mobile" />
            </Suspense>
          </div>
        </main>
      }
      right={<RightSidebar />}
    />
  )
}

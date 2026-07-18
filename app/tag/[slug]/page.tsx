import Link from 'next/link'
import { Suspense } from 'react'
import { notFound, permanentRedirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createAnonServerSupabaseClient } from '@/lib/supabase/server'
import { applyCursor, decodeCursor, encodeCursor } from '@/lib/feed/cursor'
import { fetchAuthors, fetchOrgsByPost, fetchTagsByPost } from '@/lib/feed/hydrate'
import {
  resolveTypeFilter,
  resolveTimeFilter,
  timeCutoff,
  TYPE_FILTERS,
  TIME_FILTERS,
  type TypeFilter,
  type TimeFilter,
} from '@/lib/feed/tag-filters'
import { PostCard, type PostCardData } from '@/components/post/PostCard'
import { KeyboardFeedNav } from '@/components/keyboard/KeyboardFeedNav'
import { PostCardSkeleton } from '@/components/skeleton/PostCardSkeleton'

const PAGE_SIZE = 30
/**
 * Hard cap on the first-round `post_tags → post_id` lookup. Tags in v1 have
 * small post counts; this guards against a pathological "every post is
 * tagged X" case so the `.in('id', [...])` second query stays bounded.
 */
const POST_ID_CAP = 10_000

interface PageParams {
  slug: string
}

interface PageSearchParams {
  after?: string
  type?: string
  time?: string
}

interface TagRow {
  slug: string
  name: string
  parent_tag_slug: string | null
  is_approved: boolean
}

interface ParentTagRow {
  slug: string
  name: string
}

interface PostsRow {
  id: string
  author_id: string
  type: string
  slug: string
  title: string
  summary: string
  published_at: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>
}): Promise<Metadata> {
  const { slug: rawSlug } = await params
  const slug = rawSlug.toLowerCase()

  // Mirror page-level lookup so metadata stays consistent with the body.
  const db = createAnonServerSupabaseClient()
  const { data } = await db
    .from('tags')
    .select('slug, name, is_approved')
    .eq('slug', slug)
    .maybeSingle()

  const tag = data as Pick<TagRow, 'slug' | 'name' | 'is_approved'> | null
  if (!tag || !tag.is_approved) {
    return { title: { absolute: 'Not found — agentlab.in' } }
  }

  return {
    // `title.absolute` so the layout template doesn't append a second
    // " — agentlab.in" after the `#name — agentlab.in` we build here.
    title: { absolute: `#${tag.name} — agentlab.in` },
    description: `Posts tagged #${tag.name} on agentlab.`,
    alternates: { canonical: `/tag/${tag.slug}` },
  }
}

/** Build a `/tag/<slug>?...` URL with the current filters minus `after`. */
function buildFilterHref(
  slug: string,
  type: TypeFilter,
  time: TimeFilter,
  overrides: { type?: TypeFilter; time?: TimeFilter } = {},
): string {
  const t = overrides.type ?? type
  const w = overrides.time ?? time
  const qs: string[] = []
  if (t !== 'all') qs.push(`type=${t}`)
  if (w !== 'all') qs.push(`time=${w}`)
  return qs.length === 0 ? `/tag/${slug}` : `/tag/${slug}?${qs.join('&')}`
}

/** Build the "Older →" link, preserving type/time and adding the cursor. */
function buildOlderHref(
  slug: string,
  type: TypeFilter,
  time: TimeFilter,
  cursor: string,
): string {
  const qs: string[] = []
  if (type !== 'all') qs.push(`type=${type}`)
  if (time !== 'all') qs.push(`time=${time}`)
  qs.push(`after=${cursor}`)
  return `/tag/${slug}?${qs.join('&')}`
}

const TYPE_LABEL: Record<TypeFilter, string> = {
  all: 'All',
  post: 'Posts',
  playbook: 'Playbooks',
  dive: 'Dives',
}

const TIME_LABEL: Record<TimeFilter, string> = {
  all: 'All time',
  '7d': 'Past 7 days',
  '30d': 'Past 30 days',
}

interface TagPostsListProps {
  slug: string
  typeFilter: TypeFilter
  timeFilter: TimeFilter
  cursorEncoded: string | null
}

/**
 * Slow async boundary — `post_tags` lookup → `posts` filter → author /
 * tag hydration. Extracted from the page so the breadcrumb, title, and
 * filter chips paint instantly while the cards stream in.
 */
async function TagPostsList({
  slug,
  typeFilter,
  timeFilter,
  cursorEncoded,
}: TagPostsListProps) {
  const cursor = cursorEncoded !== null ? decodeCursor(cursorEncoded) : null

  const db = createAnonServerSupabaseClient()

  // Approach A (two-query) — chosen because `applyCursor` only understands
  // top-level columns and we want clean filter + cursor semantics. The
  // first query is bounded by POST_ID_CAP, which is safe for v1's tag
  // sizes. Approach B (single nested query with manual referencedTable
  // cursor) would save a round-trip but duplicate cursor logic.
  const { data: tagPostIdsData, error: tagPostIdsError } = await db
    .from('post_tags')
    .select('post_id')
    .eq('tag_slug', slug)
    .limit(POST_ID_CAP)

  if (tagPostIdsError) {
    console.error('[tag] post_tags lookup failed:', tagPostIdsError)
  }

  const postIds = Array.isArray(tagPostIdsData)
    ? Array.from(new Set((tagPostIdsData as Array<{ post_id: string }>).map((r) => r.post_id)))
    : []

  let rows: PostsRow[] = []
  if (postIds.length > 0) {
    const baseChain = db
      .from('posts')
      .select(
        'id, author_id, type, slug, title, summary, published_at',
      )
      .in('id', postIds)
      .is('deleted_at', null)
      .lte('published_at', new Date().toISOString())

    let filtered = baseChain
    if (typeFilter !== 'all') filtered = filtered.eq('type', typeFilter)
    if (timeFilter !== 'all') filtered = filtered.gte('published_at', timeCutoff(timeFilter))

    const chain = applyCursor(filtered, cursor)
      .order('published_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE + 1)

    const { data, error } = await chain
    if (error) {
      console.error('[tag] posts query failed:', error)
    }
    rows = error || !Array.isArray(data) ? [] : (data as PostsRow[])
  }

  const hasMore = rows.length > PAGE_SIZE
  const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows

  // Hydrate authors + tags (anon RLS public-read covers both).
  const uniqueAuthorIds = Array.from(new Set(pageRows.map((r) => r.author_id)))
  const pageIds = pageRows.map((r) => r.id)
  const [authorMap, tagMap, orgMap] = await Promise.all([
    fetchAuthors(db, uniqueAuthorIds),
    fetchTagsByPost(db, pageIds),
    fetchOrgsByPost(db, pageIds),
  ])

  const cards: PostCardData[] = []
  for (const r of pageRows) {
    const author = authorMap.get(r.author_id)
    if (!author) continue
    cards.push({
      id: r.id,
      type: r.type as PostCardData['type'],
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      published_at: r.published_at,
      author: {
        username: author.username,
        display_name: author.display_name ?? author.username,
        avatar_url: author.avatar_url,
      },
      org: orgMap.get(r.id) ?? null,
      tags: tagMap.get(r.id) ?? [],
    })
  }

  const isFirstPage = cursor === null
  const olderHref =
    hasMore && pageRows.length > 0
      ? buildOlderHref(
          slug,
          typeFilter,
          timeFilter,
          encodeCursor({
            published_at: pageRows[pageRows.length - 1].published_at,
            id: pageRows[pageRows.length - 1].id,
          }),
        )
      : null

  return (
    <>
      {cards.length === 0 ? (
        <p className="home-feed__empty">
          {isFirstPage ? 'No posts tagged here yet.' : 'No more posts.'}
        </p>
      ) : (
        <KeyboardFeedNav>
          <ul className="home-feed__list">
            {cards.map((c) => (
              <li key={c.id} className="home-feed__item">
                <PostCard post={c} />
              </li>
            ))}
          </ul>
        </KeyboardFeedNav>
      )}

      {olderHref && (
        <p className="latest-feed__pagination">
          <Link href={olderHref}>Older →</Link>
        </p>
      )}
    </>
  )
}

export default async function TagPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>
  searchParams: Promise<PageSearchParams>
}) {
  const { slug: rawSlug } = await params
  const slug = rawSlug.toLowerCase()
  if (rawSlug !== slug) {
    // Canonical-lowercase: 308 redirect so search engines collapse case
    // variants onto a single URL. Mirrors `app/[username]/page.tsx`.
    permanentRedirect(`/tag/${slug}`)
  }

  const sp = await searchParams
  const typeFilter = resolveTypeFilter(sp.type)
  const timeFilter = resolveTimeFilter(sp.time)
  const cursorEncoded = typeof sp.after === 'string' ? sp.after : null

  // Tag-existence check stays in the page (not the suspended body) so
  // we can `notFound()` before any streaming starts — once a response
  // body begins streaming the status code is locked at 200. This is
  // also needed for the breadcrumb / heading copy.
  const db = createAnonServerSupabaseClient()
  const { data: tagData } = await db
    .from('tags')
    .select('slug, name, parent_tag_slug, is_approved')
    .eq('slug', slug)
    .maybeSingle()

  const tag = tagData as TagRow | null
  if (!tag || !tag.is_approved) notFound()

  // Optional breadcrumb parent lookup. One extra round-trip when the tag
  // has a parent — acceptable for a per-page render.
  let parentTag: ParentTagRow | null = null
  if (tag.parent_tag_slug) {
    const { data: parentData } = await db
      .from('tags')
      .select('slug, name')
      .eq('slug', tag.parent_tag_slug)
      .maybeSingle()
    parentTag = (parentData as ParentTagRow | null) ?? null
  }

  return (
    <main id="main-content" className="home-feed tag-page">
      <header className="home-feed__header tag-page__header">
        {parentTag && (
          <nav aria-label="Breadcrumb" className="tag-page__breadcrumb">
            <Link href={`/tag/${parentTag.slug}`}>#{parentTag.name}</Link>
            <span aria-hidden="true"> › </span>
            <span>#{tag.name}</span>
          </nav>
        )}
        <h1 className="home-feed__title">#{tag.name}</h1>
        <p className="home-feed__tagline">Posts tagged #{tag.name} on agentlab.</p>

        <nav className="tag-page__filters" aria-label="Type filter">
          {TYPE_FILTERS.map((t) => {
            const active = t === typeFilter
            return (
              <Link
                key={t}
                href={buildFilterHref(slug, typeFilter, timeFilter, { type: t })}
                className={`filter-chip${active ? ' filter-chip--active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {TYPE_LABEL[t]}
              </Link>
            )
          })}
        </nav>

        <nav className="tag-page__filters" aria-label="Time filter">
          {TIME_FILTERS.map((w) => {
            const active = w === timeFilter
            return (
              <Link
                key={w}
                href={buildFilterHref(slug, typeFilter, timeFilter, { time: w })}
                className={`filter-chip${active ? ' filter-chip--active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {TIME_LABEL[w]}
              </Link>
            )
          })}
        </nav>
      </header>

      {/* Suspense key on the filter+cursor combo: changing filters or
          page triggers a fresh skeleton, not a stale held list. */}
      <Suspense
        key={`${typeFilter}|${timeFilter}|${cursorEncoded ?? 'first'}`}
        fallback={<PostCardSkeleton count={5} />}
      >
        <TagPostsList
          slug={slug}
          typeFilter={typeFilter}
          timeFilter={timeFilter}
          cursorEncoded={cursorEncoded}
        />
      </Suspense>
    </main>
  )
}

import Link from 'next/link'
import type { Metadata } from 'next'
import { createAnonServerSupabaseClient } from '@/lib/supabase/server'
import { applyCursor, decodeCursor, encodeCursor } from '@/lib/feed/cursor'
import { fetchAuthors, fetchTagsByPost } from '@/lib/feed/hydrate'
import { PostCard, type PostCardData } from '@/components/post/PostCard'

export const metadata: Metadata = {
  title: 'Latest — agentlab.in',
  description: 'The newest posts on agentlab.',
  alternates: { canonical: '/latest' },
}

const PAGE_SIZE = 30

interface LatestRow {
  id: string
  author_id: string
  type: string
  slug: string
  title: string
  summary: string
  published_at: string
  like_count: number | null
  bookmark_count: number | null
  comment_count: number | null
}

export default async function LatestPage({
  searchParams,
}: {
  searchParams: Promise<{ after?: string }>
}) {
  const { after } = await searchParams
  // Null cursor (missing or invalid) renders page 1 — don't 400 on a
  // poisoned share link. `decodeCursor` is total per `lib/feed/cursor.ts`.
  const cursor = typeof after === 'string' ? decodeCursor(after) : null

  const db = createAnonServerSupabaseClient()

  // Fetch PAGE_SIZE + 1 so we can tell if there's another page without a
  // second round-trip. Order matches the cursor's lexicographic tuple:
  // (published_at DESC, id DESC).
  const baseChain = db
    .from('posts')
    .select(
      'id, author_id, type, slug, title, summary, published_at, like_count, bookmark_count, comment_count',
    )
    .is('deleted_at', null)
    .lte('published_at', new Date().toISOString())

  const chain = applyCursor(baseChain, cursor)
    .order('published_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE + 1)

  const { data, error } = await chain
  if (error) {
    console.error('[latest] posts query failed:', error)
  }

  const rawRows: LatestRow[] = error || !Array.isArray(data) ? [] : (data as LatestRow[])
  const hasMore = rawRows.length > PAGE_SIZE
  const rows = hasMore ? rawRows.slice(0, PAGE_SIZE) : rawRows

  // Hydrate authors + tags using the anon client — RLS public-read policies
  // on users / post_tags / tags expose what we need.
  const uniqueAuthorIds = Array.from(new Set(rows.map((r) => r.author_id)))
  const [authorMap, tagMap] = await Promise.all([
    fetchAuthors(db, uniqueAuthorIds),
    fetchTagsByPost(
      db,
      rows.map((r) => r.id),
    ),
  ])

  const cards: PostCardData[] = []
  for (const r of rows) {
    const author = authorMap.get(r.author_id)
    if (!author) continue
    cards.push({
      id: r.id,
      type: r.type as PostCardData['type'],
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      published_at: r.published_at,
      like_count: r.like_count ?? 0,
      bookmark_count: r.bookmark_count ?? 0,
      comment_count: r.comment_count ?? 0,
      author: {
        username: author.username,
        display_name: author.display_name ?? author.username,
        avatar_url: author.avatar_url,
      },
      tags: tagMap.get(r.id) ?? [],
    })
  }

  const isFirstPage = cursor === null
  const olderHref = hasMore
    ? `/latest?after=${encodeCursor({
        published_at: rows[rows.length - 1].published_at,
        id: rows[rows.length - 1].id,
      })}`
    : null

  return (
    <main className="home-feed">
      <header className="home-feed__header">
        <h1 className="home-feed__title">Latest</h1>
        <p className="home-feed__tagline">The newest posts on agentlab.</p>
      </header>

      {cards.length === 0 ? (
        <p className="home-feed__empty">
          {isFirstPage ? 'Nothing here yet.' : 'No more posts.'}
        </p>
      ) : (
        <ul className="home-feed__list">
          {cards.map((c) => (
            <li key={c.id} className="home-feed__item">
              <PostCard post={c} />
            </li>
          ))}
        </ul>
      )}

      {olderHref && (
        <p className="latest-feed__pagination">
          <Link href={olderHref}>Older →</Link>
        </p>
      )}
    </main>
  )
}

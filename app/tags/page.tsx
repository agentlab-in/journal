import Link from 'next/link'
import type { Metadata } from 'next'
import { createAnonServerSupabaseClient } from '@/lib/supabase/server'
import { FEATURED_TAG_SLUGS } from '@/lib/search/featured-tags'

export const metadata: Metadata = {
  // Title resolves to `All tags — agentlab.in` via the layout template.
  title: 'All tags',
  description: 'Browse posts on agentlab by topic.',
  alternates: { canonical: '/tags' },
}

// Page renders live post counts and the full approved-tag list — there's
// no static snapshot worth pre-rendering, and a static prerender would
// fail at build time if env vars aren't injected for the build step.
export const dynamic = 'force-dynamic'

interface TagRow {
  slug: string
  name: string
  parent_tag_slug: string | null
}

/**
 * Row shape from the joined post_tags → posts!inner query. We only need
 * tag_slug to count per tag; the `posts!inner(id)` projection is what
 * makes the inner-join filter on `posts.deleted_at` / `posts.published_at`
 * actually exclude soft-deleted and future-dated posts.
 */
interface PostTagJoinRow {
  tag_slug: string
}

/** "1 post" / "N posts" — small enough to inline. */
function postCountLabel(n: number): string {
  return n === 1 ? '1 post' : `${n} posts`
}

export default async function TagsDirectoryPage() {
  const db = createAnonServerSupabaseClient()

  // 1. Load every approved tag, alphabetical. Cheap — v1 has at most a
  //    few hundred approved tags.
  const { data: tagsData, error: tagsError } = await db
    .from('tags')
    .select('slug, name, parent_tag_slug')
    .eq('is_approved', true)
    .order('name', { ascending: true })

  if (tagsError) {
    console.error('[tags] tags query failed:', tagsError)
  }

  const tags: TagRow[] = tagsError || !Array.isArray(tagsData) ? [] : (tagsData as TagRow[])

  // 2. Count posts per tag.
  //
  //    Approach A (chosen): join through `posts!inner` and filter on
  //    posts.deleted_at IS NULL and posts.published_at <= now. One round-
  //    trip, ≤ (posts × 5) rows. Fine for v1.
  //
  //    If /tags ever feels slow, promote to a Postgres RPC
  //    (`tag_post_counts()` returning `(tag_slug, post_count)`) — see the
  //    note in the Phase 9 plan. Not worth a migration for v1.
  const { data: joinData, error: joinError } = await db
    .from('post_tags')
    .select('tag_slug, posts!inner(id)')
    .is('posts.deleted_at', null)
    .lte('posts.published_at', new Date().toISOString())

  if (joinError) {
    console.error('[tags] post counts query failed:', joinError)
  }

  const counts = new Map<string, number>()
  if (!joinError && Array.isArray(joinData)) {
    for (const row of joinData as PostTagJoinRow[]) {
      counts.set(row.tag_slug, (counts.get(row.tag_slug) ?? 0) + 1)
    }
  }

  // 3. Flatten into a single horizontal chip cloud (issue #66). The old
  //    two-level vertical tree read as a cramped stacked list; operators
  //    want a scannable pill cloud instead. Sort by post count descending
  //    (busiest topics first), tie-broken alphabetically, and surface the
  //    count inline on each chip. The parent/child hierarchy is dropped
  //    from the visual — `/tag/[slug]` is the place to drill in.
  const tagBySlug = new Map<string, TagRow>()
  for (const t of tags) tagBySlug.set(t.slug, t)

  const cloudTags = [...tags].sort((a, b) => {
    const countDelta = (counts.get(b.slug) ?? 0) - (counts.get(a.slug) ?? 0)
    if (countDelta !== 0) return countDelta
    return a.name.localeCompare(b.name)
  })

  const featuredSlugSet = new Set<string>(FEATURED_TAG_SLUGS)

  // 4. Resolve featured slugs against the approved-tags set. Silently
  //    skip any slug that isn't approved (shouldn't happen in v1 — the
  //    featured slugs are seeded pre-approved — but be defensive).
  const featuredTags = FEATURED_TAG_SLUGS.map((slug) => tagBySlug.get(slug)).filter(
    (t): t is TagRow => t !== undefined,
  )

  return (
    <main id="main-content" className="tags-page">
      <header className="tags-page__header">
        <h1 className="tags-page__title">All tags</h1>
        <p className="tags-page__tagline">Browse posts by topic.</p>
      </header>

      {tags.length === 0 ? (
        <p className="tags-page__empty">No approved tags yet.</p>
      ) : (
        <>
          {featuredTags.length > 0 && (
            <section className="tags-page__featured" aria-labelledby="tags-featured-heading">
              <h2 id="tags-featured-heading" className="tags-page__section-title">
                Featured
              </h2>
              <ul className="tags-page__featured-grid">
                {featuredTags.map((t) => (
                  <li key={t.slug}>
                    <Link href={`/tag/${t.slug}`} className="tag-chip tags-page__featured-chip">
                      #{t.name}{' '}
                      <span className="tags-page__count">
                        · {postCountLabel(counts.get(t.slug) ?? 0)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="tags-page__all" aria-labelledby="tags-all-heading">
            <h2 id="tags-all-heading" className="tags-page__section-title">
              All approved tags
            </h2>
            <ul className="tags-page__cloud">
              {cloudTags.map((t) => (
                <li key={t.slug}>
                  <Link
                    href={`/tag/${t.slug}`}
                    className={
                      featuredSlugSet.has(t.slug)
                        ? 'tag-chip tags-page__cloud-chip tags-page__cloud-chip--featured'
                        : 'tag-chip tags-page__cloud-chip'
                    }
                  >
                    #{t.name}{' '}
                    <span className="tags-page__count">
                      · {postCountLabel(counts.get(t.slug) ?? 0)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  )
}

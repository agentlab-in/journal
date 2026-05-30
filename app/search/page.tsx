import Link from 'next/link'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { createAnonServerSupabaseClient } from '@/lib/supabase/server'
import { parseSearchParams, type ParsedSearchParams } from '@/lib/search/query'
import { runSearch, type SearchHit } from '@/lib/search/run'
import { renderSnippet } from '@/lib/search/snippet'
import { FEATURED_TAG_SLUGS } from '@/lib/search/featured-tags'
import { fetchAuthors, type AuthorInfo } from '@/lib/feed/hydrate'
import { postUrl, POST_TYPES, type PostType } from '@/lib/posts/url'
import { SearchResultSkeleton } from '@/components/skeleton/SearchResultSkeleton'

const RESULT_LIMIT = 50

const TYPE_LABEL: Record<PostType, string> = {
  post: 'Posts',
  playbook: 'Playbooks',
  dive: 'Dives',
}

// Type singular labels — used inside the per-result chip.
const TYPE_CHIP_LABEL: Record<PostType, string> = {
  post: 'Post',
  playbook: 'Playbook',
  dive: 'Dive',
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

function formatDate(iso: string): string {
  return DATE_FMT.format(new Date(iso))
}

interface PageSearchParams {
  q?: string | string[]
  type?: string | string[]
  tag?: string | string[]
}

// -----------------------------------------------------------------------------
// Metadata
// -----------------------------------------------------------------------------
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>
}): Promise<Metadata> {
  const parsed = parseSearchParams(await searchParams)
  // Title resolves to `Search — agentlab.in` or `Search: <q> — agentlab.in`
  // via the layout-level `'%s — agentlab.in'` template.
  return {
    title: parsed.q ? `Search: ${parsed.q}` : 'Search',
    description: 'Search posts on agentlab.',
    // Search result pages shouldn't be indexed — every variation is a
    // pseudo-page and indexing them creates infinite crawl surface.
    robots: { index: false, follow: true },
    alternates: { canonical: '/search' },
  }
}

// -----------------------------------------------------------------------------
// URL helpers
// -----------------------------------------------------------------------------

/**
 * Build a /search URL with the current parsed params, applying overrides.
 * Overrides may set `type` to null or `tags` to a fresh list to swap a
 * single filter while preserving the rest.
 */
function buildSearchHref(
  parsed: ParsedSearchParams,
  overrides: {
    q?: string
    type?: PostType | null
    tags?: string[]
  } = {},
): string {
  const q = overrides.q ?? parsed.q
  const type = overrides.type === undefined ? parsed.type : overrides.type
  const tags = overrides.tags ?? parsed.tags

  const sp = new URLSearchParams()
  if (q) sp.set('q', q)
  if (type) sp.set('type', type)
  for (const t of tags) sp.append('tag', t)
  const qs = sp.toString()
  return qs ? `/search?${qs}` : '/search'
}

/** Toggle a single tag slug in/out of the current tag list. */
function toggleTag(parsed: ParsedSearchParams, slug: string): string[] {
  const lower = slug.toLowerCase()
  return parsed.tags.includes(lower)
    ? parsed.tags.filter((t) => t !== lower)
    : [...parsed.tags, lower]
}

// -----------------------------------------------------------------------------
// Search result item — slim, snippet-forward, no engagement counts.
// -----------------------------------------------------------------------------
function SearchResultItem({
  hit,
  author,
}: {
  hit: SearchHit
  author: AuthorInfo | undefined
}) {
  if (!author) return null
  const displayName = author.display_name ?? author.username
  const href = postUrl(author.username, hit.type, hit.slug)

  return (
    <li className="search-page__item">
      <div className="search-page__item-meta">
        <span className="search-page__item-type">{TYPE_CHIP_LABEL[hit.type]}</span>
        <span className="search-page__item-sep" aria-hidden="true">
          ·
        </span>
        <Link href={`/${author.username}`} className="search-page__item-author">
          {displayName}
        </Link>
        <span className="search-page__item-sep" aria-hidden="true">
          ·
        </span>
        <time dateTime={hit.published_at}>{formatDate(hit.published_at)}</time>
      </div>
      <h2 className="search-page__item-title">
        <Link href={href}>{hit.title}</Link>
      </h2>
      <p className="search-page__item-snippet">{renderSnippet(hit.snippet)}</p>
    </li>
  )
}

// -----------------------------------------------------------------------------
// SearchResults — slow async boundary. The Postgres full-text RPC can
// take a few hundred ms on first run (cold-cached index); extracting
// it lets the search form + filter chips render instantly.
// -----------------------------------------------------------------------------
async function SearchResults({ parsed }: { parsed: ParsedSearchParams }) {
  const db = createAnonServerSupabaseClient()
  const hits: SearchHit[] = await runSearch(
    db,
    { q: parsed.q, type: parsed.type, tags: parsed.tags },
    { limit: RESULT_LIMIT },
  )

  const uniqueAuthorIds = Array.from(new Set(hits.map((h) => h.author_id)))
  const authorMap = await fetchAuthors(db, uniqueAuthorIds)

  if (hits.length === 0) {
    return <p className="search-page__empty">No posts match. Try fewer keywords.</p>
  }

  return (
    <ul className="search-page__results">
      {hits.map((h) => (
        <SearchResultItem key={h.id} hit={h} author={authorMap.get(h.author_id)} />
      ))}
    </ul>
  )
}

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>
}) {
  const sp = await searchParams
  const parsed = parseSearchParams(sp)

  // Type chips: "All" + each post type. Active when matches current parse.
  const typeChips: Array<{ label: string; type: PostType | null }> = [
    { label: 'All', type: null },
    ...POST_TYPES.map((t) => ({ label: TYPE_LABEL[t], type: t })),
  ]

  return (
    <main id="main-content" className="search-page">
      <header className="search-page__header">
        <h1 className="search-page__title">Search</h1>

        <form action="/search" method="get" className="search-page__form" role="search">
          {/* Preserve current type + tag filters as hidden fields so a fresh
              query submission doesn't blow them away. */}
          {parsed.type && <input type="hidden" name="type" value={parsed.type} />}
          {parsed.tags.map((t) => (
            <input key={t} type="hidden" name="tag" value={t} />
          ))}
          <input
            type="search"
            name="q"
            defaultValue={parsed.q}
            placeholder="Search posts..."
            aria-label="Search query"
            className="search-page__input"
            autoComplete="off"
          />
          <button type="submit" className="search-page__submit">
            Search
          </button>
        </form>

        <nav className="search-page__filters" aria-label="Type filter">
          {typeChips.map((chip) => {
            const active = chip.type === parsed.type
            return (
              <Link
                key={chip.label}
                href={buildSearchHref(parsed, { type: chip.type })}
                className={`filter-chip${active ? ' filter-chip--active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {chip.label}
              </Link>
            )
          })}
        </nav>

        <nav className="search-page__filters" aria-label="Tag filter">
          {FEATURED_TAG_SLUGS.map((slug) => {
            const active = parsed.tags.includes(slug)
            return (
              <Link
                key={slug}
                href={buildSearchHref(parsed, { tags: toggleTag(parsed, slug) })}
                className={`filter-chip${active ? ' filter-chip--active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                #{slug}
              </Link>
            )
          })}
        </nav>
      </header>

      {parsed.q === '' ? (
        // Empty-query state: render the suggested-tags block immediately
        // — no Suspense needed because nothing async runs.
        <section className="search-page__empty-state" aria-label="Suggested tags">
          <p className="search-page__empty-hint">
            Type a query above, or browse posts by topic:
          </p>
          <ul className="search-page__suggestions">
            {FEATURED_TAG_SLUGS.map((slug) => (
              <li key={slug}>
                <Link href={`/tag/${slug}`} className="tag-chip">
                  #{slug}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        // Suspense key on the full parsed query so typing a new search
        // (which mounts a new SearchResults via different `key`)
        // re-shows the skeleton instead of holding the previous results.
        <Suspense
          key={`${parsed.q}|${parsed.type ?? ''}|${parsed.tags.join(',')}`}
          fallback={<SearchResultSkeleton count={5} />}
        >
          <SearchResults parsed={parsed} />
        </Suspense>
      )}
    </main>
  )
}

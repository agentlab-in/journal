# Home discovery rails — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-column shell to `/` — left nav + trending tags rail, center For-You feed, right rail of Top Playbooks + Top Deep Dives + featured-tags fallback. Add a new `/trending` route for the global heat-ranked feed.

**Architecture:** Two pure data functions (`getTrendingTags`, `getTopByType`) plus an `unstable_cache` wrapper module. Six new server components composed via Suspense so each rail streams independently. One client component (`LeftNav`) for active-route highlighting + auth gating. Layout is pure Tailwind utilities — no new BEM CSS.

**Tech Stack:** Next.js 16 App Router, React 19 server components, Supabase JS query builder, `unstable_cache` + `revalidateTag`, Vitest + Testing Library, Playwright + axe-core.

**Spec:** `docs/superpowers/specs/2026-06-01-home-discovery-rails-design.md`. Tracking issue: [#54](https://github.com/agentlab-in/journal/issues/54).

---

## File structure

| File | Role |
|---|---|
| `lib/feed/trending-tags.ts` | Pure data function. Fetches `post_tags` rows in window, counts by slug, returns top N. |
| `lib/feed/top-by-type.ts` | Pure data function. Fetches posts of a given type in window, scores via `computeHeatScore`, returns top N hydrated. |
| `lib/feed/discovery-cache.ts` | Three `unstable_cache` wrappers — `cachedTrendingTags`, `cachedTopPlaybooks`, `cachedTopDives`. |
| `components/home/HomeShell.tsx` | Server. 3-column grid wrapper. Pure layout. |
| `components/home/LeftSidebar.tsx` | Server. Composes `LeftNav` + `TrendingTagsRail` (latter in Suspense). |
| `components/home/LeftNav.tsx` | **Client** — uses `useSession` + `usePathname`. `variant` prop toggles sidebar (vertical) vs inline (horizontal in top nav). |
| `components/home/TrendingTagsRail.tsx` | Server, async. Awaits `cachedTrendingTags`. Returns `null` on empty. |
| `components/home/RightSidebar.tsx` | Server, async. Composes two `TopByType` (Suspense each) + `FeaturedTagsFallback` shown when both return null. |
| `components/home/TopByType.tsx` | Server, async, generic. Props: `type`, `days`, `limit`. Returns `null` on empty. |
| `components/home/FeaturedTagsFallback.tsx` | Server, pure. Renders 8 curated starter tags. |
| `components/skeleton/RailSkeleton.tsx` | 3-row shimmer skeleton, `aria-busy="true"`. |
| `app/page.tsx` | Modified — wrap existing `FeedList` in `HomeShell` + add `LeftSidebar` / `RightSidebar`. |
| `app/trending/page.tsx` | New route. Reuses existing `getLatestFeed` with heat-rank ordering. |
| `app/api/posts/route.ts` | Modified — `revalidateTag('posts')` and `revalidateTag('tags')` after successful insert. |
| `components/layout/Nav.tsx` | Modified — render `<LeftNav variant="inline" />` between search and write CTA for sub-lg viewports. |

Tests mirror the source tree under `tests/unit/feed/`, `tests/unit/components/home/`, plus E2E extensions to `tests/e2e/homepage.spec.ts`, `tests/e2e/discovery.spec.ts`, `tests/e2e/mobile.spec.ts`.

---

## Task 1: `getTrendingTags` data function

**Files:**
- Create: `lib/feed/trending-tags.ts`
- Test: `tests/unit/feed/trending-tags.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/feed/trending-tags.test.ts
import { describe, it, expect, vi } from 'vitest'
import { getTrendingTags } from '@/lib/feed/trending-tags'

function makeDb(rows: Array<{ tag_slug: string; tags: { name: string } | null }>) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (v: { data: typeof rows; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  }
  return {
    from: vi.fn().mockReturnValue(builder),
    _builder: builder,
  }
}

describe('getTrendingTags', () => {
  it('counts rows per tag_slug and returns top N ordered by count desc', async () => {
    const db = makeDb([
      { tag_slug: 'a', tags: { name: 'A-tag' } },
      { tag_slug: 'b', tags: { name: 'B-tag' } },
      { tag_slug: 'a', tags: { name: 'A-tag' } },
      { tag_slug: 'c', tags: { name: 'C-tag' } },
      { tag_slug: 'a', tags: { name: 'A-tag' } },
    ])
    // @ts-expect-error - test stub matches the shape we exercise
    const result = await getTrendingTags(db, 7, 2)
    expect(result).toEqual([
      { slug: 'a', name: 'A-tag', count: 3 },
      { slug: 'b', name: 'B-tag', count: 1 },
    ])
  })

  it('returns empty array when no rows', async () => {
    const db = makeDb([])
    // @ts-expect-error - test stub
    const result = await getTrendingTags(db, 7, 5)
    expect(result).toEqual([])
  })

  it('filters by published_at via the window, deleted_at, and tag approval', async () => {
    const db = makeDb([])
    // @ts-expect-error - test stub
    await getTrendingTags(db, 14, 5)
    expect(db.from).toHaveBeenCalledWith('post_tags')
    expect(db._builder.gte).toHaveBeenCalledWith(
      'posts.published_at',
      expect.stringMatching(/\d{4}-\d{2}-\d{2}/),
    )
    expect(db._builder.is).toHaveBeenCalledWith('posts.deleted_at', null)
    expect(db._builder.eq).toHaveBeenCalledWith('tags.approved', true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy pnpm vitest run tests/unit/feed/trending-tags.test.ts`
Expected: FAIL with `Cannot find module '@/lib/feed/trending-tags'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/feed/trending-tags.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface TrendingTag {
  slug: string
  name: string
  count: number
}

interface PostTagRow {
  tag_slug: string
  tags: { name: string } | null
}

/**
 * Top-N tags by post-count over the last `windowDays`. Counts are computed
 * in JS rather than via a Postgres GROUP BY — the corpus is bounded by the
 * 5-tags-per-post cap (locked v1) and at launch corpus is tiny, so a
 * straight scan of `post_tags` in the window is cheaper than maintaining
 * an aggregation view.
 */
export async function getTrendingTags(
  db: SupabaseClient,
  windowDays: number = 7,
  limit: number = 5,
): Promise<TrendingTag[]> {
  const windowStart = new Date(Date.now() - windowDays * 86_400_000).toISOString()
  const { data, error } = await db
    .from('post_tags')
    .select('tag_slug, tags!inner(name), posts!inner(id, published_at, deleted_at)')
    .gte('posts.published_at', windowStart)
    .is('posts.deleted_at', null)
    .eq('tags.approved', true)

  if (error) throw error
  if (!data) return []

  const counts = new Map<string, { name: string; count: number }>()
  for (const row of data as PostTagRow[]) {
    const tagName = row.tags?.name ?? row.tag_slug
    const existing = counts.get(row.tag_slug)
    if (existing) existing.count += 1
    else counts.set(row.tag_slug, { name: tagName, count: 1 })
  }

  return Array.from(counts.entries())
    .map(([slug, v]) => ({ slug, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy pnpm vitest run tests/unit/feed/trending-tags.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/feed/trending-tags.ts tests/unit/feed/trending-tags.test.ts
git commit -m "feat(feed): add getTrendingTags data function

Pure data function returning the top-N tags by post-count over a
configurable window. Counted in JS rather than via GROUP BY — the
post_tags row count in any reasonable window stays bounded by the
5-tags-per-post cap, so a straight scan beats an aggregation view.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: `getTopByType` data function

**Files:**
- Create: `lib/feed/top-by-type.ts`
- Test: `tests/unit/feed/top-by-type.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/feed/top-by-type.test.ts
import { describe, it, expect, vi } from 'vitest'
import { getTopByType } from '@/lib/feed/top-by-type'

interface PostRow {
  id: string
  title: string
  slug: string
  type: string
  author_id: string
  published_at: string
  like_count: number
  bookmark_count: number
}

function makeDb(posts: PostRow[], authors: Array<{ id: string; username: string; display_name: string | null }>) {
  const postBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (v: { data: PostRow[]; error: null }) => unknown) =>
      resolve({ data: posts, error: null }),
  }
  const userBuilder = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    then: (resolve: (v: { data: typeof authors; error: null }) => unknown) =>
      resolve({ data: authors, error: null }),
  }
  return {
    from: vi.fn().mockImplementation((table: string) =>
      table === 'posts' ? postBuilder : userBuilder,
    ),
  }
}

describe('getTopByType', () => {
  it('filters posts.type and orders by heat score descending', async () => {
    const now = new Date('2026-06-01T12:00:00Z')
    const db = makeDb(
      [
        { id: 'p1', title: 'Old viral', slug: 'old', type: 'playbook',
          author_id: 'u1', published_at: '2026-05-29T12:00:00Z',
          like_count: 100, bookmark_count: 50 },
        { id: 'p2', title: 'Fresh small', slug: 'fresh', type: 'playbook',
          author_id: 'u1', published_at: '2026-06-01T10:00:00Z',
          like_count: 3, bookmark_count: 1 },
      ],
      [{ id: 'u1', username: 'alice', display_name: 'Alice' }],
    )
    // @ts-expect-error - test stub
    const result = await getTopByType(db, 'playbook', 7, 5, now)
    // Fresh-small wins despite lower raw engagement — heat formula
    // boosts recency.
    expect(result[0].id).toBe('p2')
    expect(result[1].id).toBe('p1')
  })

  it('respects the limit', async () => {
    const db = makeDb(
      Array.from({ length: 10 }, (_, i) => ({
        id: `p${i}`,
        title: `Post ${i}`,
        slug: `p${i}`,
        type: 'dive',
        author_id: 'u1',
        published_at: '2026-06-01T10:00:00Z',
        like_count: 10 - i,
        bookmark_count: 0,
      })),
      [{ id: 'u1', username: 'alice', display_name: 'Alice' }],
    )
    // @ts-expect-error - test stub
    const result = await getTopByType(db, 'dive', 7, 3)
    expect(result).toHaveLength(3)
  })

  it('returns [] when zero posts in the window', async () => {
    const db = makeDb([], [])
    // @ts-expect-error - test stub
    const result = await getTopByType(db, 'playbook', 7, 3)
    expect(result).toEqual([])
  })

  it('returns hydrated author shape', async () => {
    const db = makeDb(
      [{ id: 'p1', title: 'T', slug: 's', type: 'playbook',
         author_id: 'u1', published_at: '2026-06-01T10:00:00Z',
         like_count: 1, bookmark_count: 0 }],
      [{ id: 'u1', username: 'alice', display_name: 'Alice' }],
    )
    // @ts-expect-error - test stub
    const result = await getTopByType(db, 'playbook', 7, 3)
    expect(result[0]).toMatchObject({
      id: 'p1',
      title: 'T',
      slug: 's',
      type: 'playbook',
      like_count: 1,
      author_username: 'alice',
      author_display_name: 'Alice',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy pnpm vitest run tests/unit/feed/top-by-type.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/feed/top-by-type.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeHeatScore } from '@/lib/heat'

export interface TopPostRow {
  id: string
  title: string
  slug: string
  type: 'playbook' | 'dive'
  published_at: string
  like_count: number
  bookmark_count: number
  author_username: string
  author_display_name: string
}

interface PostsRow {
  id: string
  title: string
  slug: string
  type: string
  author_id: string
  published_at: string
  like_count: number
  bookmark_count: number
}

interface UserRow {
  id: string
  username: string
  display_name: string | null
}

/**
 * Top-N posts of a given type, ranked by heat (same formula as For-You).
 * Pre-filters by type + recency, scores in JS, slices. Author hydration
 * is a single follow-up query keyed by the surviving rows.
 *
 * `now` injectable for deterministic tests.
 */
export async function getTopByType(
  db: SupabaseClient,
  type: 'playbook' | 'dive',
  windowDays: number = 7,
  limit: number = 3,
  now: Date = new Date(),
): Promise<TopPostRow[]> {
  const windowStart = new Date(
    now.getTime() - windowDays * 86_400_000,
  ).toISOString()

  const { data: posts, error } = await db
    .from('posts')
    .select(
      'id, title, slug, type, author_id, published_at, like_count, bookmark_count',
    )
    .eq('type', type)
    .gte('published_at', windowStart)
    .is('deleted_at', null)
    .limit(50)

  if (error) throw error
  const rows = (posts ?? []) as PostsRow[]
  if (rows.length === 0) return []

  const ranked = rows
    .map((p) => ({
      row: p,
      score: computeHeatScore(
        {
          published_at: p.published_at,
          like_count: p.like_count,
          bookmark_count: p.bookmark_count,
          tag_affinity: 0,
        },
        now,
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  const authorIds = Array.from(new Set(ranked.map((r) => r.row.author_id)))
  const { data: users } = await db
    .from('users')
    .select('id, username, display_name')
    .in('id', authorIds)
  const byId = new Map(((users ?? []) as UserRow[]).map((u) => [u.id, u]))

  return ranked.map(({ row }) => {
    const author = byId.get(row.author_id)
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      type: row.type as 'playbook' | 'dive',
      published_at: row.published_at,
      like_count: row.like_count,
      bookmark_count: row.bookmark_count,
      author_username: author?.username ?? 'unknown',
      author_display_name: author?.display_name ?? author?.username ?? 'unknown',
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy pnpm vitest run tests/unit/feed/top-by-type.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/feed/top-by-type.ts tests/unit/feed/top-by-type.test.ts
git commit -m "feat(feed): add getTopByType data function

Reuses computeHeatScore from lib/heat.ts. Filters by type + window,
scores in JS, slices top N, then hydrates authors via a single in()
query keyed on the surviving rows.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Cache wrappers + publish-API `revalidateTag`

**Files:**
- Create: `lib/feed/discovery-cache.ts`
- Modify: `app/api/posts/route.ts` (POST handler, after successful insert)
- Test: extend `tests/unit/api/posts-create.test.ts`

- [ ] **Step 1: Read the existing test to understand its fixtures**

Open `tests/unit/api/posts-create.test.ts`. Identify:
- How the existing happy-path test sets up the supabase client mock
- Where the POST handler is invoked (likely `await POST(req)` or similar)
- Any tag-attachment fixture for the "post with tags" happy path

You'll mirror that exact setup for the new test below — do NOT invent fresh fixtures.

- [ ] **Step 2: Write the failing test**

Add at the top of `tests/unit/api/posts-create.test.ts` (with the other imports):

```ts
import { revalidateTag } from 'next/cache'

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}))
```

Add at the bottom of the file (after the existing `describe` block):

```ts
describe('POST /api/posts — cache invalidation', () => {
  it("calls revalidateTag('posts') and revalidateTag('tags') after a successful insert with tags", async () => {
    vi.mocked(revalidateTag).mockClear()
    // Reproduce the existing happy-path fixture exactly:
    //   1. Build the same supabase mock the existing happy-path test uses
    //      (auth.getUser returns a valid session, posts insert succeeds,
    //      post_tags upsert succeeds).
    //   2. Build the same Request body the existing test sends
    //      (title, summary, body_md, type, tags=[<at least 1 slug>]).
    //   3. await POST(req) (mirror the existing test's invocation).
    expect(revalidateTag).toHaveBeenCalledWith('posts')
    expect(revalidateTag).toHaveBeenCalledWith('tags')
  })

  it("calls revalidateTag('posts') but NOT 'tags' when the post has no tags", async () => {
    vi.mocked(revalidateTag).mockClear()
    // Same setup as above but with tags=[] in the request body.
    expect(revalidateTag).toHaveBeenCalledWith('posts')
    expect(revalidateTag).not.toHaveBeenCalledWith('tags')
  })
})
```

The implementer fills in the fixture-setup comments by reading and mirroring the existing happy-path test in the same file.

- [ ] **Step 3: Run test to verify it fails**

Run: `rtk proxy pnpm vitest run tests/unit/api/posts-create.test.ts`
Expected: FAIL — `revalidateTag` not called.

- [ ] **Step 4: Add the cache wrappers**

```ts
// lib/feed/discovery-cache.ts
import { unstable_cache } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { getTrendingTags, type TrendingTag } from './trending-tags'
import { getTopByType, type TopPostRow } from './top-by-type'

/**
 * Each wrapper revalidates at most every 10 minutes. The publish API
 * additionally `revalidateTag('posts')` on every successful insert, so a
 * brand-new playbook surfaces immediately without waiting for the timer.
 */
export const cachedTrendingTags = unstable_cache(
  async (): Promise<TrendingTag[]> =>
    getTrendingTags(createAdminSupabaseClient(), 7, 5),
  ['trending-tags-7d-v1'],
  { revalidate: 600, tags: ['posts', 'tags'] },
)

export const cachedTopPlaybooks = unstable_cache(
  async (): Promise<TopPostRow[]> =>
    getTopByType(createAdminSupabaseClient(), 'playbook', 7, 3),
  ['top-playbooks-7d-v1'],
  { revalidate: 600, tags: ['posts'] },
)

export const cachedTopDives = unstable_cache(
  async (): Promise<TopPostRow[]> =>
    getTopByType(createAdminSupabaseClient(), 'dive', 7, 3),
  ['top-dives-7d-v1'],
  { revalidate: 600, tags: ['posts'] },
)
```

- [ ] **Step 5: Hook `revalidateTag` into the publish endpoint**

In `app/api/posts/route.ts`, find the POST handler's "successful insert" branch (after the `posts` row is created and tags are attached). Add:

```ts
import { revalidateTag } from 'next/cache'

// after successful insert + tag attachment, before NextResponse.json(...):
revalidateTag('posts')
if (validatedTags.length > 0) {
  revalidateTag('tags')
}
```

(Place the import with the other top-of-file imports. The variable name `validatedTags` should match whatever the file already calls the array of approved tag slugs being attached — adapt to existing naming.)

- [ ] **Step 6: Run tests to verify pass**

Run: `rtk proxy pnpm vitest run tests/unit/api/posts-create.test.ts`
Expected: all existing tests + the new ones PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/feed/discovery-cache.ts app/api/posts/route.ts tests/unit/api/posts-create.test.ts
git commit -m "feat(feed): cache discovery rails + invalidate on publish

unstable_cache wrappers for trending tags, top playbooks, top dives.
revalidate=600s (10 min) bounds the staleness, and the publish API now
calls revalidateTag('posts') and revalidateTag('tags') on insert so a
brand-new post surfaces in the rails immediately.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: `RailSkeleton` component

**Files:**
- Create: `components/skeleton/RailSkeleton.tsx`
- Test: `tests/unit/components/skeleton/rail-skeleton.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/skeleton/rail-skeleton.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RailSkeleton } from '@/components/skeleton/RailSkeleton'

describe('<RailSkeleton>', () => {
  it('renders aria-busy="true"', () => {
    render(<RailSkeleton />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
  })

  it('renders 3 stub rows by default', () => {
    const { container } = render(<RailSkeleton />)
    expect(container.querySelectorAll('[data-row]')).toHaveLength(3)
  })

  it('respects the rows prop', () => {
    const { container } = render(<RailSkeleton rows={5} />)
    expect(container.querySelectorAll('[data-row]')).toHaveLength(5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy pnpm vitest run tests/unit/components/skeleton/rail-skeleton.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// components/skeleton/RailSkeleton.tsx
export function RailSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="flex flex-col gap-2"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          data-row
          className="h-4 w-full animate-pulse rounded bg-bg-subtle"
        />
      ))}
    </div>
  )
}

export default RailSkeleton
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy pnpm vitest run tests/unit/components/skeleton/rail-skeleton.test.tsx`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add components/skeleton/RailSkeleton.tsx tests/unit/components/skeleton/rail-skeleton.test.tsx
git commit -m "feat(skeleton): add RailSkeleton for sidebar Suspense fallbacks

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: `TrendingTagsRail` component

**Files:**
- Create: `components/home/TrendingTagsRail.tsx`
- Test: `tests/unit/components/home/trending-tags-rail.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/home/trending-tags-rail.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrendingTagsRail } from '@/components/home/TrendingTagsRail'

vi.mock('@/lib/feed/discovery-cache', () => ({
  cachedTrendingTags: vi.fn(),
  cachedTopPlaybooks: vi.fn(),
  cachedTopDives: vi.fn(),
}))

import { cachedTrendingTags } from '@/lib/feed/discovery-cache'

describe('<TrendingTagsRail>', () => {
  it('returns null when no tags', async () => {
    vi.mocked(cachedTrendingTags).mockResolvedValueOnce([])
    const tree = await TrendingTagsRail()
    expect(tree).toBeNull()
  })

  it('renders tag links with counts', async () => {
    vi.mocked(cachedTrendingTags).mockResolvedValueOnce([
      { slug: 'orchestration', name: 'orchestration', count: 3 },
      { slug: 'memory', name: 'memory', count: 2 },
    ])
    const tree = await TrendingTagsRail()
    render(tree)
    const link = screen.getByRole('link', { name: /#orchestration/ })
    expect(link).toHaveAttribute('href', '/tag/orchestration')
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy pnpm vitest run tests/unit/components/home/trending-tags-rail.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Add a third test for the strip variant**

Append to `tests/unit/components/home/trending-tags-rail.test.tsx`:

```tsx
  it('renders horizontally scrollable when variant="strip"', async () => {
    vi.mocked(cachedTrendingTags).mockResolvedValueOnce([
      { slug: 'orchestration', name: 'orchestration', count: 3 },
    ])
    const tree = await TrendingTagsRail({ variant: 'strip' })
    const { container } = render(tree)
    const list = container.querySelector('ul')
    expect(list?.className).toMatch(/overflow-x-auto/)
  })
```

- [ ] **Step 4: Implement (covers both variants)**

```tsx
// components/home/TrendingTagsRail.tsx
import Link from 'next/link'
import { cachedTrendingTags } from '@/lib/feed/discovery-cache'

interface TrendingTagsRailProps {
  /**
   * 'list' (default) = vertical list with counts on the right. Used in
   * the desktop left sidebar.
   * 'strip' = horizontally scrollable pill row. Used at <lg above the
   * feed where the sidebars are hidden.
   */
  variant?: 'list' | 'strip'
}

export async function TrendingTagsRail({
  variant = 'list',
}: TrendingTagsRailProps = {}) {
  const tags = await cachedTrendingTags()
  if (tags.length === 0) return null

  if (variant === 'strip') {
    return (
      <section aria-labelledby="trending-tags-strip-heading" className="px-4">
        <h2 id="trending-tags-strip-heading" className="sr-only">
          Trending tags
        </h2>
        <ul
          role="list"
          aria-label="Trending tags"
          className="flex flex-row gap-2 overflow-x-auto py-2 text-sm
                     [scrollbar-width:none]
                     [-ms-overflow-style:none]
                     [&::-webkit-scrollbar]:hidden"
        >
          {tags.map((t) => (
            <li key={t.slug} className="shrink-0">
              <Link
                href={`/tag/${encodeURIComponent(t.slug)}`}
                className="tag-chip"
              >
                #{t.name}
                <span className="ml-1 text-fg-subtle">{t.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <section aria-labelledby="trending-tags-heading">
      <h2
        id="trending-tags-heading"
        className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-fg-subtle"
      >
        Trending tags
      </h2>
      <ul className="flex flex-col gap-1 text-sm">
        {tags.map((t) => (
          <li key={t.slug} className="flex items-baseline justify-between gap-2">
            <Link
              href={`/tag/${encodeURIComponent(t.slug)}`}
              className="text-fg hover:underline"
            >
              #{t.name}
            </Link>
            <span className="text-xs text-fg-subtle">{t.count}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default TrendingTagsRail
```

- [ ] **Step 5: Run test to verify it passes**

Run: `rtk proxy pnpm vitest run tests/unit/components/home/trending-tags-rail.test.tsx`
Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add components/home/TrendingTagsRail.tsx tests/unit/components/home/trending-tags-rail.test.tsx
git commit -m "feat(home): add TrendingTagsRail (sidebar list + mobile strip)

Variants: 'list' for the desktop left sidebar (vertical) and 'strip'
for the sub-lg horizontally-scrollable row above the feed. Single
component, single data fetch (cached) — variant prop toggles layout.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: `TopByType` component

**Files:**
- Create: `components/home/TopByType.tsx`
- Test: `tests/unit/components/home/top-by-type.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/home/top-by-type.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TopByType } from '@/components/home/TopByType'

vi.mock('@/lib/feed/discovery-cache', () => ({
  cachedTrendingTags: vi.fn(),
  cachedTopPlaybooks: vi.fn(),
  cachedTopDives: vi.fn(),
}))

import {
  cachedTopPlaybooks,
  cachedTopDives,
} from '@/lib/feed/discovery-cache'

const sample = {
  id: 'p1',
  title: 'Trust gate',
  slug: 'trust-gate',
  type: 'playbook' as const,
  published_at: '2026-06-01T00:00:00Z',
  like_count: 12,
  bookmark_count: 3,
  author_username: 'alice',
  author_display_name: 'Alice',
}

describe('<TopByType>', () => {
  it('returns null when empty (playbook)', async () => {
    vi.mocked(cachedTopPlaybooks).mockResolvedValueOnce([])
    const tree = await TopByType({ type: 'playbook' })
    expect(tree).toBeNull()
  })

  it('returns null when empty (dive)', async () => {
    vi.mocked(cachedTopDives).mockResolvedValueOnce([])
    const tree = await TopByType({ type: 'dive' })
    expect(tree).toBeNull()
  })

  it('renders title + author + like count when populated (playbook)', async () => {
    vi.mocked(cachedTopPlaybooks).mockResolvedValueOnce([sample])
    render(await TopByType({ type: 'playbook' }))
    expect(
      screen.getByRole('heading', { name: /top playbooks this week/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('Trust gate')).toBeInTheDocument()
    expect(screen.getByText('@alice')).toBeInTheDocument()
    expect(screen.getByText(/12/)).toBeInTheDocument()
  })

  it('uses the dive heading for type=dive', async () => {
    vi.mocked(cachedTopDives).mockResolvedValueOnce([
      { ...sample, type: 'dive', title: 'Memory primitives' },
    ])
    render(await TopByType({ type: 'dive' }))
    expect(
      screen.getByRole('heading', { name: /top deep dives this week/i }),
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy pnpm vitest run tests/unit/components/home/top-by-type.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// components/home/TopByType.tsx
import Link from 'next/link'
import {
  cachedTopPlaybooks,
  cachedTopDives,
} from '@/lib/feed/discovery-cache'
import { postUrl } from '@/lib/posts/url'

interface TopByTypeProps {
  type: 'playbook' | 'dive'
}

const HEADING: Record<TopByTypeProps['type'], string> = {
  playbook: 'Top Playbooks this week',
  dive: 'Top Deep Dives this week',
}

export async function TopByType({ type }: TopByTypeProps) {
  const rows = type === 'playbook'
    ? await cachedTopPlaybooks()
    : await cachedTopDives()
  if (rows.length === 0) return null

  const headingId = `top-${type}-heading`
  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-fg-subtle"
      >
        {HEADING[type]}
      </h2>
      <ul className="flex flex-col gap-2 text-sm">
        {rows.map((p) => (
          <li key={p.id}>
            <Link
              href={postUrl(p.author_username, p.type, p.slug)}
              className="block font-medium text-fg hover:underline"
            >
              {p.title}
            </Link>
            <p className="text-xs text-fg-subtle">
              @{p.author_username} · {p.like_count} ♥
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default TopByType
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy pnpm vitest run tests/unit/components/home/top-by-type.test.tsx`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add components/home/TopByType.tsx tests/unit/components/home/top-by-type.test.tsx
git commit -m "feat(home): add TopByType right-sidebar module (playbook + dive)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: `FeaturedTagsFallback` component

**Files:**
- Create: `components/home/FeaturedTagsFallback.tsx`
- Test: `tests/unit/components/home/featured-tags-fallback.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/home/featured-tags-fallback.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FeaturedTagsFallback } from '@/components/home/FeaturedTagsFallback'

describe('<FeaturedTagsFallback>', () => {
  it('renders the curated 8 starter tags', () => {
    render(<FeaturedTagsFallback />)
    const tags = [
      'security', 'local-first', 'orchestration', 'memory',
      'evals', 'tooling', 'prompting', 'multi-agent',
    ]
    for (const slug of tags) {
      const link = screen.getByRole('link', { name: `#${slug}` })
      expect(link).toHaveAttribute('href', `/tag/${slug}`)
    }
  })

  it('uses the "Starter topics" heading', () => {
    render(<FeaturedTagsFallback />)
    expect(
      screen.getByRole('heading', { name: /starter topics/i }),
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy pnpm vitest run tests/unit/components/home/featured-tags-fallback.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// components/home/FeaturedTagsFallback.tsx
import Link from 'next/link'

// From project_agentlab_v1_choices.md:49 — locked v1 featured tag list.
const STARTER_TAGS = [
  'security',
  'local-first',
  'orchestration',
  'memory',
  'evals',
  'tooling',
  'prompting',
  'multi-agent',
] as const

export function FeaturedTagsFallback() {
  return (
    <section aria-labelledby="starter-topics-heading">
      <h2
        id="starter-topics-heading"
        className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-fg-subtle"
      >
        Starter topics
      </h2>
      <p className="mb-2 text-xs text-fg-subtle">
        While the platform fills up, here are the starter topics worth exploring.
      </p>
      <ul className="flex flex-wrap gap-1.5 text-sm">
        {STARTER_TAGS.map((slug) => (
          <li key={slug}>
            <Link href={`/tag/${slug}`} className="tag-chip">
              #{slug}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default FeaturedTagsFallback
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy pnpm vitest run tests/unit/components/home/featured-tags-fallback.test.tsx`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add components/home/FeaturedTagsFallback.tsx tests/unit/components/home/featured-tags-fallback.test.tsx
git commit -m "feat(home): add FeaturedTagsFallback for empty-rail state

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: `LeftNav` component

**Files:**
- Create: `components/home/LeftNav.tsx`
- Test: `tests/unit/components/home/left-nav.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/home/left-nav.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const mockUseSession = vi.fn()
const mockUsePathname = vi.fn()

vi.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

import { LeftNav } from '@/components/home/LeftNav'

afterEach(() => {
  cleanup()
  mockUseSession.mockReset()
  mockUsePathname.mockReset()
})

describe('<LeftNav>', () => {
  it('always shows Home, Trending, All tags', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' })
    mockUsePathname.mockReturnValue('/')
    render(<LeftNav />)
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Trending' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All tags' })).toBeInTheDocument()
  })

  it('hides Bookmarks + Profile when anon', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' })
    mockUsePathname.mockReturnValue('/')
    render(<LeftNav />)
    expect(screen.queryByRole('link', { name: 'Bookmarks' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull()
  })

  it('shows Bookmarks + Profile when authenticated', () => {
    mockUseSession.mockReturnValue({
      status: 'authenticated',
      data: { user: { username: 'alice' } },
    })
    mockUsePathname.mockReturnValue('/')
    render(<LeftNav />)
    expect(screen.getByRole('link', { name: 'Bookmarks' })).toHaveAttribute(
      'href',
      '/bookmarks',
    )
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute(
      'href',
      '/alice',
    )
  })

  it('marks the active route with aria-current="page"', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' })
    mockUsePathname.mockReturnValue('/trending')
    render(<LeftNav />)
    expect(screen.getByRole('link', { name: 'Trending' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute(
      'aria-current',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy pnpm vitest run tests/unit/components/home/left-nav.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// components/home/LeftNav.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'

interface NavItem {
  href: string
  label: string
  authOnly?: boolean
}

const STATIC_ITEMS: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/trending', label: 'Trending' },
  { href: '/bookmarks', label: 'Bookmarks', authOnly: true },
  { href: '/tags', label: 'All tags' },
]

interface LeftNavProps {
  /**
   * 'sidebar' (default) = vertical column list. Used inside LeftSidebar.
   * 'inline' = horizontal pill list. Used inside the top Nav for sub-lg.
   */
  variant?: 'sidebar' | 'inline'
}

export function LeftNav({ variant = 'sidebar' }: LeftNavProps) {
  const pathname = usePathname()
  const { data: session, status } = useSession()
  const authed = status === 'authenticated'
  const username = session?.user?.username ?? null

  const items: NavItem[] = STATIC_ITEMS.filter(
    (i) => !i.authOnly || authed,
  )
  if (authed && username) {
    items.push({ href: `/${username}`, label: 'Profile' })
  }

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  const listClass =
    variant === 'sidebar'
      ? 'flex flex-col gap-1'
      : 'flex flex-row flex-wrap gap-2'
  const itemBaseClass =
    variant === 'sidebar'
      ? 'block rounded px-2 py-1 text-sm'
      : 'block rounded px-2 py-1 text-xs'

  return (
    <nav aria-label="Section navigation">
      <ul className={listClass}>
        {items.map((item) => {
          const active = isActive(item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`${itemBaseClass} ${
                  active
                    ? 'bg-bg-hover font-semibold text-fg'
                    : 'text-fg-subtle hover:bg-bg-hover hover:text-fg'
                }`}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default LeftNav
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy pnpm vitest run tests/unit/components/home/left-nav.test.tsx`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add components/home/LeftNav.tsx tests/unit/components/home/left-nav.test.tsx
git commit -m "feat(home): add LeftNav client component with auth gating

Self-contained — reads useSession + usePathname so the same component
can be rendered in both the desktop sidebar and the sub-lg top nav with
no parent plumbing. variant=sidebar vs variant=inline toggles vertical
vs horizontal layout.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: `LeftSidebar` component

**Files:**
- Create: `components/home/LeftSidebar.tsx`
- Test: `tests/unit/components/home/left-sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/home/left-sidebar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/home/LeftNav', () => ({
  LeftNav: () => <nav data-testid="left-nav-stub" />,
}))
vi.mock('@/components/home/TrendingTagsRail', () => ({
  TrendingTagsRail: () => <div data-testid="trending-stub" />,
}))

import { LeftSidebar } from '@/components/home/LeftSidebar'

describe('<LeftSidebar>', () => {
  it('renders LeftNav + TrendingTagsRail', () => {
    render(<LeftSidebar />)
    expect(screen.getByTestId('left-nav-stub')).toBeInTheDocument()
    expect(screen.getByTestId('trending-stub')).toBeInTheDocument()
  })

  it('uses aside with the primary-navigation label', () => {
    render(<LeftSidebar />)
    expect(
      screen.getByRole('complementary', { name: /primary navigation/i }),
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy pnpm vitest run tests/unit/components/home/left-sidebar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// components/home/LeftSidebar.tsx
import { Suspense } from 'react'
import { LeftNav } from './LeftNav'
import { TrendingTagsRail } from './TrendingTagsRail'
import { RailSkeleton } from '@/components/skeleton/RailSkeleton'

export function LeftSidebar() {
  return (
    <aside
      aria-label="Primary navigation"
      className="flex flex-col gap-6"
    >
      <LeftNav variant="sidebar" />
      <Suspense fallback={<RailSkeleton rows={4} />}>
        {/* TrendingTagsRail returns null on empty — Suspense fallback
            shows only while the cache miss resolves. */}
        <TrendingTagsRail />
      </Suspense>
    </aside>
  )
}

export default LeftSidebar
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy pnpm vitest run tests/unit/components/home/left-sidebar.test.tsx`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add components/home/LeftSidebar.tsx tests/unit/components/home/left-sidebar.test.tsx
git commit -m "feat(home): add LeftSidebar composition

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: `RightSidebar` component

**Files:**
- Create: `components/home/RightSidebar.tsx`
- Test: `tests/unit/components/home/right-sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/home/right-sidebar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/feed/discovery-cache', () => ({
  cachedTrendingTags: vi.fn(),
  cachedTopPlaybooks: vi.fn(),
  cachedTopDives: vi.fn(),
}))

import {
  cachedTopPlaybooks,
  cachedTopDives,
} from '@/lib/feed/discovery-cache'
import { RightSidebar } from '@/components/home/RightSidebar'

const sample = {
  id: 'p1',
  title: 'Trust gate',
  slug: 'trust-gate',
  type: 'playbook' as const,
  published_at: '2026-06-01T00:00:00Z',
  like_count: 12,
  bookmark_count: 3,
  author_username: 'alice',
  author_display_name: 'Alice',
}

describe('<RightSidebar>', () => {
  it('renders the FeaturedTagsFallback when both modules are empty', async () => {
    vi.mocked(cachedTopPlaybooks).mockResolvedValueOnce([])
    vi.mocked(cachedTopDives).mockResolvedValueOnce([])
    render(await RightSidebar())
    expect(
      screen.getByRole('heading', { name: /starter topics/i }),
    ).toBeInTheDocument()
  })

  it('does NOT render the fallback when at least one module has data', async () => {
    vi.mocked(cachedTopPlaybooks).mockResolvedValueOnce([sample])
    vi.mocked(cachedTopDives).mockResolvedValueOnce([])
    render(await RightSidebar())
    expect(screen.queryByRole('heading', { name: /starter topics/i })).toBeNull()
    expect(
      screen.getByRole('heading', { name: /top playbooks/i }),
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy pnpm vitest run tests/unit/components/home/right-sidebar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// components/home/RightSidebar.tsx
import { TopByType } from './TopByType'
import { FeaturedTagsFallback } from './FeaturedTagsFallback'
import {
  cachedTopPlaybooks,
  cachedTopDives,
} from '@/lib/feed/discovery-cache'

/**
 * The fallback decision needs the rail data *before* deciding what to
 * render, so we await both queries here instead of nesting Suspense
 * boundaries around each TopByType. Trade-off: one slow query blocks the
 * whole right rail's first paint. Acceptable because both queries hit
 * the same cache + same Postgres connection — they finish ~together.
 */
export async function RightSidebar() {
  const [playbooks, dives] = await Promise.all([
    cachedTopPlaybooks(),
    cachedTopDives(),
  ])
  const showFallback = playbooks.length === 0 && dives.length === 0

  return (
    <aside aria-label="Showcase" className="flex flex-col gap-6">
      {playbooks.length > 0 ? <TopByType type="playbook" /> : null}
      {dives.length > 0 ? <TopByType type="dive" /> : null}
      {showFallback ? <FeaturedTagsFallback /> : null}
    </aside>
  )
}

export default RightSidebar
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy pnpm vitest run tests/unit/components/home/right-sidebar.test.tsx`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add components/home/RightSidebar.tsx tests/unit/components/home/right-sidebar.test.tsx
git commit -m "feat(home): add RightSidebar with FeaturedTagsFallback

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: `HomeShell` component

**Files:**
- Create: `components/home/HomeShell.tsx`
- Test: `tests/unit/components/home/home-shell.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/home/home-shell.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/home/LeftSidebar', () => ({
  LeftSidebar: () => <aside data-testid="left-stub" />,
}))
vi.mock('@/components/home/RightSidebar', () => ({
  RightSidebar: () => <aside data-testid="right-stub" />,
}))

import { HomeShell } from '@/components/home/HomeShell'

describe('<HomeShell>', () => {
  it('renders left + children + right', async () => {
    render(
      await HomeShell({
        children: <div data-testid="feed-children">feed</div>,
      }),
    )
    expect(screen.getByTestId('left-stub')).toBeInTheDocument()
    expect(screen.getByTestId('feed-children')).toBeInTheDocument()
    expect(screen.getByTestId('right-stub')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy pnpm vitest run tests/unit/components/home/home-shell.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// components/home/HomeShell.tsx
import { Suspense, type ReactNode } from 'react'
import { LeftSidebar } from './LeftSidebar'
import { RightSidebar } from './RightSidebar'
import { TrendingTagsRail } from './TrendingTagsRail'
import { RailSkeleton } from '@/components/skeleton/RailSkeleton'

/**
 * Three-column grid wrapper for the home page.
 *
 *   xl  : 200px + 1fr + 280px
 *   lg  : 1fr + 260px   (left collapses — sub-lg viewports get LeftNav
 *                        inline in the top Nav.tsx)
 *   <lg : single column (sidebars hidden, trending tags become a
 *                        horizontal strip rendered above the feed)
 *
 * Sidebars get their own Suspense boundary so a slow rail query never
 * blocks the center feed's first paint. The mobile trending strip is in
 * its own Suspense too so it can stream independently of the feed.
 */
interface HomeShellProps {
  children: ReactNode
}

export function HomeShell({ children }: HomeShellProps) {
  return (
    <div
      className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6
                 grid-cols-1
                 lg:grid-cols-[1fr_260px]
                 xl:grid-cols-[200px_1fr_280px]"
    >
      <Suspense fallback={<RailSkeleton rows={6} />}>
        <div className="hidden xl:block">
          <LeftSidebar />
        </div>
      </Suspense>

      <div className="min-w-0">
        {/* Mobile-only trending strip — sits above the feed at <lg.
            TrendingTagsRail returns null on empty, so this collapses
            cleanly when the corpus is sparse. */}
        <div className="lg:hidden">
          <Suspense fallback={null}>
            <TrendingTagsRail variant="strip" />
          </Suspense>
        </div>
        <div className="mx-auto max-w-2xl">{children}</div>
      </div>

      <Suspense fallback={<RailSkeleton rows={6} />}>
        <div className="hidden lg:block">
          <RightSidebar />
        </div>
      </Suspense>
    </div>
  )
}

export default HomeShell
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy pnpm vitest run tests/unit/components/home/home-shell.test.tsx`
Expected: 1 test PASSES.

- [ ] **Step 5: Commit**

```bash
git add components/home/HomeShell.tsx tests/unit/components/home/home-shell.test.tsx
git commit -m "feat(home): add HomeShell three-column grid wrapper

xl: 200/1fr/280, lg: 1fr/260 (left collapses to top nav), <lg: single
column. Each sidebar wraps in its own Suspense so slow rail queries
don't block the center feed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: Render `LeftNav` inline in top `Nav.tsx` for sub-lg viewports

**Files:**
- Modify: `components/layout/Nav.tsx`
- Test: extend `tests/unit/components/nav-auth.test.tsx` — actually, a new test file is cleaner since this is the top Nav, not NavAuth.
- Create: `tests/unit/components/layout/nav.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/layout/nav.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

import Nav from '@/components/layout/Nav'

describe('<Nav>', () => {
  it('renders LeftNav in inline mode (hidden on lg via class)', () => {
    render(<Nav />)
    // Inline LeftNav renders a <nav aria-label="Section navigation">.
    // The wrapper has lg:hidden so it only paints below the lg breakpoint.
    const wrapper = screen
      .getByRole('navigation', { name: /section navigation/i })
      .closest('div')
    expect(wrapper?.className).toMatch(/lg:hidden/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy pnpm vitest run tests/unit/components/layout/nav.test.tsx`
Expected: FAIL — Nav doesn't render LeftNav yet.

- [ ] **Step 3: Modify `components/layout/Nav.tsx`**

In the existing Nav file, between `<NavSearch />` and the right-side cluster, insert:

```tsx
import { LeftNav } from '@/components/home/LeftNav'

// inside the <nav> JSX, after <NavSearch />:
<div className="lg:hidden">
  <LeftNav variant="inline" />
</div>
```

(Keep the rest of the file unchanged — Logo + NavSearch + ThemeToggle + NavAuth ordering stays.)

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy pnpm vitest run tests/unit/components/layout/nav.test.tsx`
Expected: 1 test PASSES.

- [ ] **Step 5: Verify the desktop Nav doesn't regress**

Run: `rtk proxy pnpm vitest run tests/unit/components/nav-auth.test.tsx`
Expected: 4/4 PASS (unchanged).

- [ ] **Step 6: Commit**

```bash
git add components/layout/Nav.tsx tests/unit/components/layout/nav.test.tsx
git commit -m "feat(nav): render inline LeftNav for sub-lg viewports

Single source of truth — same LeftNav component, variant=inline,
lg:hidden so it only paints when the desktop sidebar is collapsed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 13: Integrate `HomeShell` into `app/page.tsx`

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Write the integration test (E2E)**

We don't unit-test `app/page.tsx` directly — its assembly is exercised by the existing `tests/e2e/homepage.spec.ts`. The new assertion lands in Task 15. For now, just make the change and rely on `pnpm typecheck` + the existing homepage spec to catch regressions.

- [ ] **Step 2: Apply the change**

In `app/page.tsx`, wrap the existing `<Suspense fallback={...}><FeedList ... /></Suspense>` plus the "See all posts →" link in `<HomeShell>`. The header (`home-feed__header`) stays *outside* the shell so it sits above the columns at full page width.

Find the existing `return` block of `HomePage()` and replace it with:

```tsx
import { HomeShell } from '@/components/home/HomeShell'

// inside HomePage():
return (
  <main id="main-content">
    <header className="mx-auto w-full max-w-7xl px-4 pt-6">
      <h1 className="text-2xl font-bold">{showingForYou ? 'For you' : 'Latest'}</h1>
      <p className="text-sm text-fg-subtle">
        {showingForYou
          ? 'Posts ranked by recency and engagement, biased toward tags you follow.'
          : 'The newest posts on agentlab.'}
      </p>
    </header>
    <HomeShell>
      <Suspense fallback={<PostCardSkeleton count={5} />}>
        <FeedList viewerId={viewerId} />
      </Suspense>
      <p className="home-feed__more">
        <Link href="/latest">See all posts →</Link>
      </p>
    </HomeShell>
  </main>
)
```

Drop the old `home-feed` className wrapper — the shell + the existing `home-feed__more` link is enough.

- [ ] **Step 3: Verify typecheck + existing home tests**

Run: `rtk proxy pnpm typecheck`
Expected: clean.

Run: `rtk proxy pnpm vitest run tests/unit/home.test.ts 2>/dev/null` (only if that file exists — otherwise skip).

- [ ] **Step 4: Visual smoke check**

Start dev: `rtk proxy pnpm dev` in background. Visit `http://localhost:3010/`. Expected: three-column layout on xl viewports; right rail collapses below lg; sidebars hidden at <lg with top-nav inline links visible.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat(home): wrap FeedList in HomeShell

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 14: New `/trending` route

**Files:**
- Create: `app/trending/page.tsx`
- Test: covered by E2E in Task 15.

- [ ] **Step 1: Implement the route**

```tsx
// app/trending/page.tsx
import Link from 'next/link'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { getLatestFeed } from '@/lib/feed'
import {
  fetchAuthors,
  fetchTagsByPost,
} from '@/lib/feed/hydrate'
import { PostCard, type PostCardData } from '@/components/post/PostCard'
import { PostCardSkeleton } from '@/components/skeleton/PostCardSkeleton'
import { HomeShell } from '@/components/home/HomeShell'
import { computeHeatScore } from '@/lib/heat'

export const metadata: Metadata = {
  title: 'Trending',
  description: 'What people are reading right now on agentlab.',
}

async function TrendingFeed() {
  const db = createAdminSupabaseClient()
  const now = new Date()
  const windowStart = new Date(now.getTime() - 7 * 86_400_000).toISOString()

  // Fetch the last week of posts, then re-score by heat. Reusing
  // getLatestFeed would order by published_at desc — we want heat order.
  const { data: posts } = await db
    .from('posts')
    .select(
      'id, title, slug, type, summary, author_id, published_at, like_count, bookmark_count, comment_count',
    )
    .gte('published_at', windowStart)
    .is('deleted_at', null)
    .limit(200)

  const rows = (posts ?? []).map((p) => ({
    p,
    score: computeHeatScore(
      {
        published_at: p.published_at,
        like_count: p.like_count,
        bookmark_count: p.bookmark_count,
        tag_affinity: 0,
      },
      now,
    ),
  }))
  rows.sort((a, b) => b.score - a.score)
  const top = rows.slice(0, 30).map((r) => r.p)

  if (top.length === 0) {
    return (
      <p className="text-fg-subtle">
        No posts trending yet. Check back soon.
      </p>
    )
  }

  const authorIds = Array.from(new Set(top.map((p) => p.author_id)))
  const authorMap = await fetchAuthors(db, authorIds)
  const tagMap = await fetchTagsByPost(db, top.map((p) => p.id))

  const cards: PostCardData[] = []
  for (const p of top) {
    const author = authorMap.get(p.author_id)
    if (!author) continue
    cards.push({
      id: p.id,
      type: p.type as PostCardData['type'],
      slug: p.slug,
      title: p.title,
      summary: p.summary,
      published_at: p.published_at,
      like_count: p.like_count,
      bookmark_count: p.bookmark_count,
      comment_count: p.comment_count,
      author: {
        username: author.username,
        display_name: author.display_name ?? author.username,
        avatar_url: author.avatar_url,
      },
      tags: tagMap.get(p.id) ?? [],
    })
  }

  return (
    <ul className="flex flex-col gap-4">
      {cards.map((c) => (
        <li
          key={c.id}
          className="border-b border-border pb-4 last:border-b-0"
        >
          <PostCard post={c} />
        </li>
      ))}
    </ul>
  )
}

export default function TrendingPage() {
  return (
    <main id="main-content">
      <header className="mx-auto w-full max-w-7xl px-4 pt-6">
        <h1 className="text-2xl font-bold">Trending</h1>
        <p className="text-sm text-fg-subtle">
          What people are reading right now on agentlab.
        </p>
      </header>
      <HomeShell>
        <Suspense fallback={<PostCardSkeleton count={5} />}>
          <TrendingFeed />
        </Suspense>
        <p className="home-feed__more">
          <Link href="/latest">See latest posts →</Link>
        </p>
      </HomeShell>
    </main>
  )
}
```

- [ ] **Step 2: Verify typecheck**

Run: `rtk proxy pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Smoke check via dev server**

Run: `rtk proxy pnpm dev` in background. Visit `http://localhost:3010/trending`. Expect a heat-ranked list (or the empty-state copy). Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add app/trending/page.tsx
git commit -m "feat(routes): add /trending heat-ranked global feed

Re-scores the last 7 days by heat (recency + engagement) and shows the
top 30. Reuses HomeShell so the sidebars stay consistent.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 15: E2E coverage — homepage shell, /trending, mobile responsive

**Files:**
- Modify: `tests/e2e/homepage.spec.ts`
- Modify: `tests/e2e/discovery.spec.ts`
- Modify: `tests/e2e/mobile.spec.ts`

- [ ] **Step 1: Extend `tests/e2e/homepage.spec.ts`**

Add a new test at the bottom of the existing `test.describe` (or as a separate `test(...)`):

```ts
test('home shell renders both sidebars on a desktop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const response = await page.goto('/', { waitUntil: 'load' })
  expect(response?.status()).toBeLessThan(500)

  // LeftSidebar
  await expect(
    page.getByRole('complementary', { name: /primary navigation/i }),
  ).toBeVisible()
  // LeftNav sidebar variant
  await expect(
    page.getByRole('link', { name: 'Home', exact: true }).first(),
  ).toBeVisible()
  // RightSidebar
  await expect(
    page.getByRole('complementary', { name: /showcase/i }),
  ).toBeVisible()
})
```

- [ ] **Step 2: Run the E2E to verify pass**

Run: `rtk proxy pnpm e2e tests/e2e/homepage.spec.ts`
Expected: all tests PASS.

- [ ] **Step 3: Extend `tests/e2e/discovery.spec.ts` for /trending**

Add:

```ts
test('/trending route returns 200 and renders a heading + shell', async ({ page }) => {
  const response = await page.goto('/trending', { waitUntil: 'load' })
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: /^trending$/i })).toBeVisible()
  // FeedList content OR the empty-state copy must show.
  await expect(
    page.locator('main').getByText(/(no posts trending yet|comments|likes)/i).first(),
  ).toBeVisible({ timeout: 5000 })
})
```

- [ ] **Step 4: Run the E2E**

Run: `rtk proxy pnpm e2e tests/e2e/discovery.spec.ts`
Expected: PASS.

- [ ] **Step 5: Extend `tests/e2e/mobile.spec.ts`**

Add:

```ts
test('home: sub-lg viewport hides both sidebars and shows the inline LeftNav in the top nav', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 })
  await page.goto('/', { waitUntil: 'load' })
  // Both <aside>s are present in the DOM but hidden via CSS.
  await expect(
    page.getByRole('complementary', { name: /primary navigation/i }),
  ).toBeHidden()
  await expect(
    page.getByRole('complementary', { name: /showcase/i }),
  ).toBeHidden()
  // Inline LeftNav is visible inside the top nav.
  const navLandmarks = page.getByRole('navigation', { name: /section navigation/i })
  await expect(navLandmarks.first()).toBeVisible()
})
```

- [ ] **Step 6: Run mobile E2E**

Run: `rtk proxy pnpm e2e tests/e2e/mobile.spec.ts`
Expected: PASS.

- [ ] **Step 7: Run the a11y sweep**

Run: `rtk proxy pnpm a11y`
Expected: zero serious/critical violations on `/` (light + dark) and `/trending`.

- [ ] **Step 8: Commit**

```bash
git add tests/e2e/homepage.spec.ts tests/e2e/discovery.spec.ts tests/e2e/mobile.spec.ts
git commit -m "test(e2e): cover home shell, /trending, mobile sidebar collapse

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Final verification

After Task 15, run the full local suite once more and confirm nothing else regressed:

- [ ] `rtk proxy pnpm typecheck` — clean
- [ ] `rtk proxy pnpm test` — all unit tests pass (note: a handful of pre-existing `theme-toggle.test.tsx` + `draft-manager.test.tsx` failures around `window.localStorage` are upstream, not introduced by this work)
- [ ] `rtk proxy pnpm a11y` — zero serious/critical violations
- [ ] Push to `develop`: `git push origin develop`
- [ ] Move issue #54 → Done (link the commit range in a closing comment)
- [ ] Open `develop → main` PR when ready to ship to prod

## Out-of-scope reminders

This plan does NOT implement (per the spec's deferred list):
- Who-to-follow widget
- Hot discussions widget
- Mini-profile widget
- Drafts as a nav route
- Promoting the shell to `/latest`, `/tag/[slug]`, `/search`
- Bottom-tab mobile nav

If any task tempts you toward these, stop and update the spec first.

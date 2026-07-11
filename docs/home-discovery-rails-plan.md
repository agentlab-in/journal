# Home discovery rails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan phase-by-phase. Each phase below is a single implementer worker's PR scope, branched from and merged back into `develop`.

**Goal:** Ship a three-column shell on `/` (left nav + trending tags, center For-You feed, right rail of Top Playbooks + Top Deep Dives + featured-tags fallback) and a new `/trending` route that serves a global heat-ranked feed.

**Architecture:** Two pure server-side data functions (`getTrendingTags`, `getTopByType`) wrapped in `unstable_cache` with tag-based invalidation (`revalidateTag('posts')` fired from the publish API). Six new server components composed via `<Suspense>` boundaries so each rail streams independently; one client component (`LeftNav`) for active-route highlighting + auth gating. Layout is pure Tailwind utilities (existing zinc-neutral palette, no shadcn/Radix, no component library). All work is additive — falls back to the current single-column layout cleanly if any rail errors.

**Tech Stack:** Same as the rest of the repo — Next.js 16 App Router, React 19 server components, TypeScript strict, Supabase JS, Vitest + Testing Library for units, Playwright + axe-core for E2E/a11y. **No** new dependencies.

**Spec:** [`docs/superpowers/specs/2026-06-01-home-discovery-rails-design.md`](./superpowers/specs/2026-06-01-home-discovery-rails-design.md) — read end-to-end before starting any phase. This plan refines and phases the spec; where the two conflict, the spec wins on shape, this plan wins on rollout sequence.

**Tracking:** Issue [#54](https://github.com/agentlab-in/journal/issues/54). Does not block Phase 15 launch but is scheduled for the pre-launch window per the operator.

**Status:** PLAN (no code yet). Phases A → B → C are sequential — Phase B depends on the shell from A, Phase C depends on the cache plumbing from B.

---

## Table of contents

1. [Out of scope](#out-of-scope)
2. [Open product calls](#open-product-calls) — operator decisions before phase A starts
3. [Design — file structure](#design--file-structure)
4. [Design — data layer & caching](#design--data-layer--caching)
5. [Design — component API](#design--component-api)
6. [Design — responsive matrix](#design--responsive-matrix)
7. [Phase A — shell + skeleton + responsive scaffolding](#phase-a--shell--skeleton--responsive-scaffolding)
8. [Phase B — data layer + caching + rails hooked up](#phase-b--data-layer--caching--rails-hooked-up)
9. [Phase C — `/trending` route + polish + risk tests](#phase-c--trending-route--polish--risk-tests)
10. [Cross-phase test matrix](#cross-phase-test-matrix)
11. [Risks](#risks)
12. [Rollout](#rollout)

---

## Out of scope

These are explicitly NOT in this plan. Do not smuggle them into any phase. Each item below is deferred per issue #54 or the design spec.

- **Who-to-follow / suggestion algorithm.** Needs corpus + ranking work. v1.2+.
- **Hot discussions / active comment threads.** Needs comment volume. v1.2+.
- **Mini-profile / user-stats widget.** Redundant with avatar dropdown + profile-page stats.
- **Drafts as a nav route.** Locked v1 keeps drafts in localStorage only; no server-side list to render.
- **Bottom-tab mobile nav.** The single-source `LeftNav` rendered into both desktop sidebar and mobile top-nav is enough for v1.1.
- **Promoting the three-column shell to other feed routes** (`/latest`, `/tag/[slug]`, `/search`). Wait until the home version proves out.
- **Schema changes / new tables / denormalized caches.** The trending-tags and top-by-type queries run live over `posts` + `post_tags` + `tags`; `unstable_cache` is the only caching layer. No migrations in this plan.
- **Personalized "For You" ranking changes.** The existing tag-affinity heat score stays as-is — these rails are global, not viewer-personalized.
- **Component library (shadcn / Radix).** Locked brand decision: mono, no generic library aesthetic. Tailwind utility classes only.
- **Emoji icons in nav.** Same brand reason. Text labels only.
- **Changing `/`'s primary feed surface.** Center column remains the existing For-You-or-Latest `FeedList` from `app/page.tsx`. Anon viewers see Latest; authed viewers see For You. No redirect to `/trending`.

---

## Open product calls

The operator (Harshit) must confirm each of these before the corresponding phase starts. Each has a default; if the operator does not respond by the time the phase opens, the implementer uses the default and notes it in the PR body.

### Top 3 (highest leverage — call out in PR body)

**OPC-1. `/` for authed users — stay on For-You or redirect to `/trending`?** ✅ **DECIDED (2026-06-06, operator on PR #61): (a) stay on For-You.**
- (a) **stay on For-You.** Issue #54 says "center feed (existing For You)" and the spec preserves this. Personalization is the whole reason a viewer is signed in. `/trending` is one click away in the left nav.
- (b) Redirect authed users to `/trending`. Discourages the For-You feed; closer to Twitter's "Following / For You" tab model.
- (c) Add a tab toggle at the top of `/` — `For You | Trending` — and remember the choice in a cookie.
**Implication for Phase B implementer:** no redirect logic in `app/page.tsx`. Authed viewers continue to see the existing For-You `FeedList`. Operator note: "for you page is fine and it is actually better".

**OPC-2. `/` for anonymous viewers — show Latest or Trending in the center column?** ✅ **DECIDED (2026-06-06, operator on PR #61): (a) keep Latest.**
- (a) **keep Latest.** Matches the current behavior in `app/page.tsx:118-127`. Trending is one click away.
- (b) Switch anon `/` to Trending. Better "what's hot" first impression for cold visitors.
**Implication for Phase B implementer:** the anon path in `FeedList` (`viewerId === null` → `getLatestFeed`) is unchanged. Operator note: "the latest is better for now".

**OPC-3. Settings link in `LeftNav`?** ✅ **DECIDED (2026-06-06, operator on PR #61): (b) drop it.**
- (a) Issue #54 says `Settings (authed)` in the nav list.
- (b) **drop it.** The spec drops Settings in favor of `Profile (/{username})`. Settings already lives in the avatar dropdown (`components/layout/ProfileMenu.tsx`), so the LeftNav would be a duplicate.
**Implication for Phase A implementer:** `LeftNav` items when authed are `Home → Trending → All tags → Bookmarks → Profile`. No Settings entry. Track as a follow-up if user feedback says Settings is hard to find. Operator note: "recommendation is ok".

### Smaller calls (each has a clear default — confirm or override)

**OPC-4. Trending-tags chip clickability.** Default: **yes**, each chip is a `<Link href={'/tag/' + slug}>`. Matches the spec at line 92.

**OPC-5. Mobile trending-strip overflow behavior.**
- Default: horizontal `overflow-x-auto` with `snap-x snap-mandatory` and `scroll-padding-inline-start: 16px`. Each chip is a `snap-start` item. No scrollbar styling beyond the OS default. No paging arrows in v1.1.
- Trade-off: arrows would help discoverability but add 2 buttons + 2 a11y labels per render. Defer.

**OPC-6. Featured-tags fallback — exact tag set.**
- Default: reuse `FEATURED_TAG_SLUGS` from `lib/search/featured-tags.ts` — `['security','local-first','orchestration','memory','evals','tooling','prompting','multi-agent']`. Same eight tags the `/tags` and `/search` pages already use.
- Do NOT introduce a new constant. The whole point of reusing is single-source-of-truth.

**OPC-7. `unstable_cache` TTL.**
- Default: `revalidate: 600` (10 minutes) per the spec. Tag invalidation (`revalidateTag('posts')`) is the fast path; the TTL is the safety net.
- Trade-off considered: tighter (60s) would mask any missing `revalidateTag` call faster but multiplies DB load on the unauthenticated cold cache. Stick with 10 min.

**OPC-8. `LeftNav` item order — authed vs anon.**
- Default (anon): Home → Trending → All tags.
- Default (authed): Home → Trending → All tags → Bookmarks → Profile.
- Active-route highlight via `aria-current="page"` on the matching anchor.
- Trade-off: putting Profile last keeps the personal-stuff cluster (Bookmarks + Profile) at the bottom and the public-discovery cluster (Home, Trending, Tags) at the top. Matches the spec mental model of "navigation: public first, personal second".

**OPC-9. "See all" link on each `TopByType` rail.**
- Default: **no link in v1.1.** The rails are showcase, not browse-points; the playbook / dive listings aren't a thing yet (deferred — `/playbooks` and `/dives` don't exist). Add a `<Link>` later when those routes ship.
- Trade-off: users may want "more like this". They can click any tag chip on a card. Good enough for v1.1.

**OPC-10. `/trending` vs `/latest` differentiation.**
- Default: distinct copy at the top of each page.
  - `/latest`: H1 "Latest" · tagline "The newest posts on agentlab."
  - `/trending`: H1 "Trending" · tagline "What people are reading this week."
- Only `/trending` is in the left nav. `/latest` stays linkable from the home "See all posts →" footer. No banner or tooltip explaining the difference — the copy carries the meaning.

---

## Design — file structure

| File | Status | Role |
|---|---|---|
| `lib/feed/trending-tags.ts` | **Create** | Pure data function. Selects `post_tags` joined to `posts` filtered to 7-day window, counts by tag slug (in-memory), returns top N hydrated with tag name. |
| `lib/feed/top-by-type.ts` | **Create** | Pure data function. Selects `posts` of a given type in the 7-day window, scores via `computeHeatScore` from `lib/heat.ts`, returns top N with author + counts. |
| `lib/feed/discovery-cache.ts` | **Create** | Three `unstable_cache` wrappers — `cachedTrendingTags`, `cachedTopPlaybooks`, `cachedTopDives`. First introduction of `unstable_cache` to the repo (grep confirms no prior usage). |
| `components/home/HomeShell.tsx` | **Create** | Server. 3-column Tailwind grid wrapper. Pure layout, no fetching, no state. |
| `components/home/LeftSidebar.tsx` | **Create** | Server. Composes `LeftNav` + `TrendingTagsRail` (latter in its own Suspense). |
| `components/home/LeftNav.tsx` | **Create** | **Client.** Uses `useSession` + `usePathname`. No props (self-contained, per the spec at line 73). |
| `components/home/TrendingTagsRail.tsx` | **Create** | Server, async. Awaits `cachedTrendingTags`. Returns `null` on empty. |
| `components/home/RightSidebar.tsx` | **Create** | Server, async. Composes two `TopByType` (Suspense each) + `FeaturedTagsFallback` shown only when both `TopByType` resolve to null. |
| `components/home/TopByType.tsx` | **Create** | Server, async, generic. Single `type` prop; window/limit are fixed by the cache wrappers (`cachedTopPlaybooks`, `cachedTopDives`) so the component stays a thin renderer. Returns `null` on empty. |
| `components/home/FeaturedTagsFallback.tsx` | **Create** | Server, pure. Renders 8 curated starter tags from `FEATURED_TAG_SLUGS`. |
| `components/home/TrendingStrip.tsx` | **Create** | Server, async. Mobile (<lg) horizontal-scroll variant of `TrendingTagsRail`. Reuses `cachedTrendingTags`. |
| `components/skeleton/RailSkeleton.tsx` | **Create** | 3-row shimmer matching `PostCardSkeleton`'s visual vocabulary. `aria-busy="true"`, `role="status"`. |
| `app/page.tsx` | **Modify** | Wrap existing header + `FeedList` in `HomeShell`; add `LeftSidebar` and `RightSidebar` as siblings of the center column. Keep the existing `<Suspense fallback={<PostCardSkeleton count={5} />}>` boundary around `FeedList` unchanged. |
| `app/trending/page.tsx` | **Create** | New route. Heat-ranked global feed (anon-readable). Reuses `HomeShell` + the existing `FeedList` shape but ordered by heat. |
| `app/api/posts/route.ts` | **Modify** | After successful `posts` insert, call `revalidateTag('posts')`. When `newTagSlugs.length > 0`, also call `revalidateTag('tags')`. |
| `components/layout/Nav.tsx` | **Modify** | Add a sub-`lg` row of nav links (rendered via the same `LeftNav` component) so mobile users keep access to Home / Trending / Tags / Bookmarks / Profile when the left sidebar is hidden. |
| `app/globals.css` | **Modify** | Add `.home-shell`, `.home-shell__left`, `.home-shell__right`, `.rail-heading`, `.trending-strip` selectors. Match the existing `.home-feed__*` naming convention already in `app/globals.css:2493-2563`. |

Tests live alongside the source tree:

| Test file | Status | Coverage |
|---|---|---|
| `tests/unit/feed/trending-tags.test.ts` | **Create** | `getTrendingTags` shape, ordering, window filter, approved filter |
| `tests/unit/feed/top-by-type.test.ts` | **Create** | `getTopByType` filters by type, respects limit, sorts by `computeHeatScore` |
| `tests/unit/components/home/home-shell.test.tsx` | **Create** | `HomeShell` renders left + center + right grid cells |
| `tests/unit/components/home/left-nav.test.tsx` | **Create** | Active-route `aria-current`, auth gating for Bookmarks/Profile |
| `tests/unit/components/home/trending-tags-rail.test.tsx` | **Create** | Returns null on empty; renders `<Link>` per tag with count |
| `tests/unit/components/home/top-by-type.test.tsx` | **Create** | Returns null on empty; renders title + author + likes |
| `tests/unit/components/home/right-sidebar.test.tsx` | **Create** | Fallback renders only when both `TopByType` are null |
| `tests/unit/components/home/featured-tags-fallback.test.tsx` | **Create** | Renders the 8 starter tags |
| `tests/unit/api/posts-create.test.ts` | **Modify** | New assertion: `revalidateTag` called with `'posts'` (and `'tags'` when new tags) |
| `tests/e2e/homepage.spec.ts` | **Modify** | Shell visible at xl, trending tags rail present, at least one playbook seed visible |
| `tests/e2e/discovery.spec.ts` | **Modify** | `/trending` returns 200, renders heat-ranked feed |
| `tests/e2e/mobile.spec.ts` | **Modify** | At <lg width: sidebars hidden, trending strip visible, top-nav links present |
| `tests/e2e/a11y.spec.ts` | **Modify** (config-only) | `/` and `/trending` covered in the existing axe sweep — confirm zero serious/critical |

---

## Design — data layer & caching

### `getTrendingTags`

`lib/feed/trending-tags.ts`

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface TrendingTag {
  slug: string
  name: string
  count: number
}

export async function getTrendingTags(
  db: Pick<SupabaseClient, 'from'>,
  windowDays: number = 7,
  limit: number = 5,
): Promise<TrendingTag[]>
```

Implementation shape (live query, no denormalized cache table — see "Caching" below for why):

```ts
const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString()

const { data, error } = await db
  .from('post_tags')
  .select('tag_slug, tags!inner(slug, name, is_approved), posts!inner(published_at, deleted_at)')
  .gte('posts.published_at', sinceIso)
  .is('posts.deleted_at', null)
  .eq('tags.is_approved', true)

if (error || !Array.isArray(data)) return []

// In-memory count + sort. The window is 7d so the row count is bounded
// by (posts in last 7d) × (tags per post, capped at ~5 by the publish API).
const counts = new Map<string, { name: string; count: number }>()
for (const row of data as Array<{ tag_slug: string; tags: { name: string } }>) {
  const prev = counts.get(row.tag_slug)
  if (prev) prev.count += 1
  else counts.set(row.tag_slug, { name: row.tags.name, count: 1 })
}

return [...counts.entries()]
  .map(([slug, v]) => ({ slug, name: v.name, count: v.count }))
  .sort((a, b) => b.count - a.count)
  .slice(0, limit)
```

**Schema notes (for the implementer who isn't familiar with the column names — the spec at line 148 uses `t.approved` which is wrong):**

- The column on `public.tags` is `is_approved` (not `approved`). See `supabase/migrations/0002_content.sql:93`.
- Featured tags ship pre-approved via the seed at `supabase/migrations/0002_content.sql:753`.
- `public.posts.deleted_at` is the soft-delete column; filter `IS NULL` for "not deleted".

### `getTopByType`

`lib/feed/top-by-type.ts`

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeHeatScore } from '@/lib/heat'

export interface TopPostRow {
  id: string
  slug: string
  title: string
  type: 'playbook' | 'dive'
  author_username: string
  author_display_name: string
  like_count: number
}

export async function getTopByType(
  db: Pick<SupabaseClient, 'from'>,
  type: 'playbook' | 'dive',
  windowDays: number = 7,
  limit: number = 3,
): Promise<TopPostRow[]>
```

Implementation shape:

```ts
const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString()

const { data, error } = await db
  .from('posts')
  .select(
    'id, slug, title, type, published_at, like_count, bookmark_count, author:users!posts_author_id_fkey(username, display_name)',
  )
  .eq('type', type)
  .gte('published_at', sinceIso)
  .is('deleted_at', null)
  .order('published_at', { ascending: false })
  .limit(50) // pull a small shortlist; rerank in memory

if (error || !Array.isArray(data)) return []

type Row = {
  id: string; slug: string; title: string; type: string; published_at: string
  like_count: number | null; bookmark_count: number | null
  author: { username: string; display_name: string } | null
}

const scored = (data as Row[])
  .filter((r) => r.author != null)
  .map((r) => ({
    row: r,
    score: computeHeatScore({
      published_at: r.published_at,
      like_count: r.like_count ?? 0,
      bookmark_count: r.bookmark_count ?? 0,
      tag_affinity: 0, // global, no viewer affinity here
    }),
  }))
  .sort((a, b) => b.score - a.score)
  .slice(0, limit)

return scored.map(({ row }) => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  type: row.type as TopPostRow['type'],
  author_username: row.author!.username,
  author_display_name: row.author!.display_name,
  like_count: row.like_count ?? 0,
}))
```

**Why rerank in memory rather than ordering in SQL:** `computeHeatScore` already exists, is unit-tested, and is the canonical formulation. Replicating it in SQL means two definitions of "heat" to keep in sync. A 50-row in-memory pass is trivial compared to the network round-trip.

### Caching

`lib/feed/discovery-cache.ts`

```ts
import { unstable_cache } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { getTrendingTags } from './trending-tags'
import { getTopByType } from './top-by-type'

export const cachedTrendingTags = unstable_cache(
  () => getTrendingTags(createAdminSupabaseClient(), 7, 5),
  ['trending-tags-v1'],
  { revalidate: 600, tags: ['posts', 'tags'] },
)

export const cachedTopPlaybooks = unstable_cache(
  () => getTopByType(createAdminSupabaseClient(), 'playbook', 7, 3),
  ['top-playbooks-7d-v1'],
  { revalidate: 600, tags: ['posts'] },
)

export const cachedTopDives = unstable_cache(
  () => getTopByType(createAdminSupabaseClient(), 'dive', 7, 3),
  ['top-dives-7d-v1'],
  { revalidate: 600, tags: ['posts'] },
)
```

**Key shape:** the cache key is `[<keyParts...>, ...args]`. Because we pass zero args (the data functions close over their config), the key is just the keyParts string. If you ever add a per-viewer variant, change the version suffix (`-v2`) so old entries expire.

**Why a service-role client inside the cache wrapper:** the cached result is shared across all viewers, so it must be a viewer-agnostic query. Service-role bypasses RLS, but every column read here (`posts.published_at`, `posts.title`, `tags.name`, etc.) is already covered by a public-read RLS policy — service-role is used for query simplicity, not for privileged data access.

**Invalidation contract:** the publish API at `app/api/posts/route.ts` MUST call `revalidateTag('posts')` after a successful insert (step 13 in that file). When `newTagSlugs.length > 0` (step 10), also call `revalidateTag('tags')`. The unit test at `tests/unit/api/posts-create.test.ts` enforces this — drift on this contract is the #1 risk (see Risks section).

**No edit/delete invalidation in this plan.** The publish-only invalidation is sufficient for v1.1: edits update an existing post that's already in the top-N cache (the title may go stale but the membership doesn't); deletes happen via soft-delete and the next 10-minute TTL refresh drops the row. If post-edit staleness becomes user-visible, add `revalidateTag('posts')` to the edit handler in a follow-up.

---

## Design — component API

### `HomeShell`

`components/home/HomeShell.tsx` — **server, sync** (no `'use client'`, no `await`).

```tsx
import type { ReactNode } from 'react'

export interface HomeShellProps {
  left: ReactNode
  center: ReactNode
  right: ReactNode
}

export function HomeShell({ left, center, right }: HomeShellProps) {
  return (
    <div className="home-shell grid gap-8 xl:grid-cols-[200px_minmax(0,1fr)_280px] lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-6">
      <aside className="home-shell__left hidden xl:block" aria-label="Primary navigation">{left}</aside>
      <div className="home-shell__center min-w-0">{center}</div>
      <aside className="home-shell__right hidden lg:block" aria-label="Showcase">{right}</aside>
    </div>
  )
}
```

**Critical:** `HomeShell` MUST stay synchronous. The whole streaming benefit depends on the page-level `viewerId` resolving in the parent and the shell painting immediately. If you find yourself reaching for `async` here, you have introduced a waterfall — back out.

### `LeftSidebar`

`components/home/LeftSidebar.tsx` — server, sync. Composes:

```tsx
import { Suspense } from 'react'
import { LeftNav } from './LeftNav'
import { TrendingTagsRail } from './TrendingTagsRail'
import { RailSkeleton } from '@/components/skeleton/RailSkeleton'

export function LeftSidebar() {
  return (
    <div className="flex flex-col gap-8">
      <LeftNav />
      <Suspense fallback={<RailSkeleton rows={5} />}>
        <TrendingTagsRail />
      </Suspense>
    </div>
  )
}
```

### `LeftNav`

`components/home/LeftNav.tsx` — **client.** No props.

```tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'

const PUBLIC_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/trending', label: 'Trending' },
  { href: '/tags', label: 'All tags' },
] as const

export function LeftNav() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const username = session?.user?.username ?? null

  const items = [
    ...PUBLIC_ITEMS,
    ...(session ? [{ href: '/bookmarks', label: 'Bookmarks' }] : []),
    ...(username ? [{ href: `/${username}`, label: 'Profile' }] : []),
  ]

  return (
    <nav aria-label="Section navigation">
      <ul className="flex flex-col gap-1 list-none p-0 m-0">
        {items.map((it) => (
          <li key={it.href}>
            <Link
              href={it.href}
              aria-current={pathname === it.href ? 'page' : undefined}
              className="block px-2 py-1 font-mono text-sm text-muted hover:text-fg aria-[current=page]:text-fg aria-[current=page]:font-bold"
            >
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
```

**No icons.** Brand decision locked — text labels only.

### `TrendingTagsRail`

`components/home/TrendingTagsRail.tsx` — server, async.

```tsx
import Link from 'next/link'
import { cachedTrendingTags } from '@/lib/feed/discovery-cache'

export async function TrendingTagsRail() {
  const tags = await cachedTrendingTags()
  if (tags.length === 0) return null
  return (
    <section aria-labelledby="trending-tags-heading">
      <h2 id="trending-tags-heading" className="rail-heading">Trending tags</h2>
      <ul role="list" className="flex flex-col gap-1 list-none p-0 m-0">
        {tags.map((t) => (
          <li key={t.slug}>
            <Link href={`/tag/${t.slug}`} className="font-mono text-sm text-muted hover:text-fg">
              <span>#{t.name}</span>
              <span className="ml-1 text-xs opacity-60">{t.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

### `RightSidebar`

`components/home/RightSidebar.tsx` — server, async. Must await both `TopByType` instances itself (not via Suspense) so it can detect the "both empty" state and render the fallback. The spec at lines 95-107 shows `<Suspense>` around each, but that prevents the parent from knowing they returned null. Resolved as: render the rails directly inside `<Suspense>` for streaming, AND query the cache once in the parent for the fallback decision. See implementation below.

```tsx
import { Suspense } from 'react'
import { TopByType } from './TopByType'
import { FeaturedTagsFallback } from './FeaturedTagsFallback'
import { RailSkeleton } from '@/components/skeleton/RailSkeleton'
import { cachedTopPlaybooks, cachedTopDives } from '@/lib/feed/discovery-cache'

export async function RightSidebar() {
  // The same cached calls TopByType performs. unstable_cache memoizes
  // within a request, so this is a single round-trip per rail across
  // the whole tree, not two.
  const [playbooks, dives] = await Promise.all([cachedTopPlaybooks(), cachedTopDives()])
  const bothEmpty = playbooks.length === 0 && dives.length === 0

  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<RailSkeleton rows={3} />}>
        <TopByType type="playbook" />
      </Suspense>
      <Suspense fallback={<RailSkeleton rows={3} />}>
        <TopByType type="dive" />
      </Suspense>
      {bothEmpty && <FeaturedTagsFallback />}
    </div>
  )
}
```

**Trade-off accepted:** the parent awaits the cached data before its child Suspense streams. In practice the cache is hot in 99% of requests so this is a memory map lookup, not a DB hit; on a cold cache the parent blocks the right sidebar's first paint but `<aside>` is already deferred behind `lg:block` so the user doesn't perceive it on mobile.

### `TopByType`

`components/home/TopByType.tsx` — server, async, generic.

```tsx
import Link from 'next/link'
import { cachedTopPlaybooks, cachedTopDives } from '@/lib/feed/discovery-cache'

export interface TopByTypeProps {
  type: 'playbook' | 'dive'
}

export async function TopByType({ type }: TopByTypeProps) {
  const rows = await (type === 'playbook' ? cachedTopPlaybooks() : cachedTopDives())
  if (rows.length === 0) return null
  const heading = type === 'playbook' ? 'Top playbooks this week' : 'Top deep dives this week'
  return (
    <section aria-labelledby={`top-${type}-heading`}>
      <h2 id={`top-${type}-heading`} className="rail-heading">{heading}</h2>
      <ul role="list" className="flex flex-col gap-2 list-none p-0 m-0">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/${r.author_username}/${type === 'playbook' ? 'playbook' : 'dive'}/${r.slug}`} className="block font-mono text-sm">
              <span className="block text-fg">{r.title}</span>
              <span className="text-xs text-muted">@{r.author_username} · ♥ {r.like_count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

**URL construction:** the canonical post URL is `/<leading_segment>/<type>/<slug>`. The implementer should use `postUrl()` from `@/lib/posts/url` instead of the literal string concatenation above to stay consistent with the rest of the codebase. The example is illustrative.

### `FeaturedTagsFallback`

`components/home/FeaturedTagsFallback.tsx` — server, pure.

```tsx
import Link from 'next/link'
import { FEATURED_TAG_SLUGS } from '@/lib/search/featured-tags'

export function FeaturedTagsFallback() {
  return (
    <section aria-labelledby="starter-topics-heading">
      <h2 id="starter-topics-heading" className="rail-heading">Starter topics</h2>
      <ul role="list" className="flex flex-wrap gap-2 list-none p-0 m-0">
        {FEATURED_TAG_SLUGS.map((slug) => (
          <li key={slug}>
            <Link href={`/tag/${slug}`} className="font-mono text-xs px-2 py-1 border border-border rounded hover:bg-muted/10">
              #{slug}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

### `TrendingStrip`

`components/home/TrendingStrip.tsx` — server, async. Mobile equivalent of `TrendingTagsRail` for <`lg`. Renders horizontally with `snap-x snap-mandatory`. Hidden at ≥`lg` via Tailwind `lg:hidden`.

```tsx
import Link from 'next/link'
import { cachedTrendingTags } from '@/lib/feed/discovery-cache'

export async function TrendingStrip() {
  const tags = await cachedTrendingTags()
  if (tags.length === 0) return null
  return (
    <nav aria-label="Trending tags" className="trending-strip lg:hidden overflow-x-auto snap-x snap-mandatory">
      <ul role="list" className="flex gap-2 px-4 py-2 list-none m-0">
        {tags.map((t) => (
          <li key={t.slug} className="snap-start shrink-0">
            <Link href={`/tag/${t.slug}`} className="font-mono text-xs px-2 py-1 border border-border rounded">
              #{t.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
```

### `RailSkeleton`

`components/skeleton/RailSkeleton.tsx` — purely presentational, matches `PostCardSkeleton`'s vocabulary.

```tsx
import { SkeletonText } from './Skeleton'

export interface RailSkeletonProps {
  rows?: number
}

export function RailSkeleton({ rows = 3 }: RailSkeletonProps = {}) {
  return (
    <section role="status" aria-label="Loading rail" aria-busy="true">
      <SkeletonText className="!h-3 !w-24 mb-2 opacity-50" />
      <ul className="flex flex-col gap-2 list-none p-0 m-0">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i}><SkeletonText className="!w-full" /></li>
        ))}
      </ul>
    </section>
  )
}
```

---

## Design — responsive matrix

| Viewport | Shell | Behavior |
|---|---|---|
| `xl` (≥1280px) | 3-col `200px · minmax(0,1fr) · 280px` | Full layout. Center capped at the existing 672px max-width via `.home-feed`. |
| `lg` (1024–1279px) | 2-col `minmax(0,1fr) · 260px` | Left sidebar hidden. `LeftNav` items merge into the top nav via `<LeftNav />` rendered inside `components/layout/Nav.tsx` between search and auth controls (display-toggled with `lg:flex xl:hidden`). The trending tags rail moves into the **top of the right sidebar** above Top Playbooks. |
| `<lg` (≤1023px) | 1-col | Both `<aside>` panels hidden. `TrendingStrip` renders above the feed. Top Playbooks + Top Deep Dives append **after** the feed as plain `<section>` blocks (not collapsibles in v1.1 — defer collapsibility). `LeftNav` items merge into the top nav as a row of links. |

**CSS plumbing:**

- Use Tailwind utilities; no new BEM classes except `.rail-heading` (uppercase micro-label) and `.trending-strip` (because the snap behavior needs a stable selector for E2E targeting).
- The `lg:` and `xl:` breakpoints already exist in `tailwind.config.ts`. No config changes.
- Reduced-motion: skeleton shimmer already respects `prefers-reduced-motion: reduce` at `app/globals.css:229-240`. No new rules needed.

---

## Phase A — shell + skeleton + responsive scaffolding

**PR size:** S. ~400 LoC, no data layer, no caching. Lands the layout chassis and the empty-state visuals so subsequent phases have somewhere to plug rails into.

**Branch:** `feat/home-discovery-rails-shell` off `develop`. **PR target:** `develop`.

**Files:**

- **Create:**
  - `components/home/HomeShell.tsx`
  - `components/home/LeftSidebar.tsx` — **stub version**: renders `<LeftNav />` only (no `TrendingTagsRail` yet — that lands in Phase B)
  - `components/home/LeftNav.tsx` (client)
  - `components/home/RightSidebar.tsx` — **stub version**: renders `<RailSkeleton rows={3} />` x2, no data
  - `components/skeleton/RailSkeleton.tsx`
  - `tests/unit/components/home/home-shell.test.tsx`
  - `tests/unit/components/home/left-nav.test.tsx`
- **Modify:**
  - `app/page.tsx` — wrap `<header>` + `<Suspense>FeedList<.../>` + `<p>See all</p>` in `HomeShell` `center` slot; pass `<LeftSidebar />` and `<RightSidebar />` (stub) into `left` and `right` slots
  - `components/layout/Nav.tsx` — add `<LeftNav />` between `<NavSearch />` and `<div>...auth controls...</div>`, wrapped in `<div className="lg:flex xl:hidden">` so it only appears at the `lg` and below breakpoints when the left sidebar is hidden
  - `app/globals.css` — add `.home-shell`, `.home-shell__left`, `.home-shell__right`, `.rail-heading`, `.trending-strip` selectors

**Tests:**

- Unit: `HomeShell` renders all three named slots; cells have correct `aria-label`s.
- Unit: `LeftNav` marks the active route with `aria-current="page"`; renders Bookmarks + Profile only when `useSession()` returns a session; hides them when `session` is null.
- E2E (extend `tests/e2e/homepage.spec.ts`): at ≥1280px viewport, all three columns visible; at 1024px, left sidebar hidden, top-nav has the link row; at 800px, both sidebars hidden.
- A11y: `tests/e2e/a11y.spec.ts` already iterates `/`; confirm zero serious/critical violations with the new shell in place.

**Acceptance:**

- `pnpm test` green.
- `pnpm test:e2e tests/e2e/homepage.spec.ts tests/e2e/mobile.spec.ts tests/e2e/a11y.spec.ts` green.
- Visual sanity: `/` at xl, lg, sm shows the shell with skeleton placeholders in the rails (no real data yet).
- No regressions in existing `homepage.spec.ts` and `discovery.spec.ts`.

**Out of scope for Phase A:**

- Any data layer. The right sidebar renders skeletons forever in this phase — that's correct.
- `/trending` route.
- `revalidateTag` wiring.

**Dependencies:** none. Can start immediately.

---

## Phase B — data layer + caching + rails hooked up

**PR size:** M. ~700 LoC. Lands the data functions, the `unstable_cache` wrappers, the `revalidateTag` call, and swaps the right sidebar stubs for real rails.

**Branch:** `feat/home-discovery-rails-data` off the merged Phase-A commit on `develop`. **PR target:** `develop`.

**Files:**

- **Create:**
  - `lib/feed/trending-tags.ts`
  - `lib/feed/top-by-type.ts`
  - `lib/feed/discovery-cache.ts`
  - `components/home/TrendingTagsRail.tsx`
  - `components/home/TopByType.tsx`
  - `components/home/FeaturedTagsFallback.tsx`
  - `components/home/TrendingStrip.tsx`
  - `tests/unit/feed/trending-tags.test.ts`
  - `tests/unit/feed/top-by-type.test.ts`
  - `tests/unit/components/home/trending-tags-rail.test.tsx`
  - `tests/unit/components/home/top-by-type.test.tsx`
  - `tests/unit/components/home/right-sidebar.test.tsx`
  - `tests/unit/components/home/featured-tags-fallback.test.tsx`
- **Modify:**
  - `components/home/LeftSidebar.tsx` — add `<Suspense><TrendingTagsRail /></Suspense>` (was missing in Phase A's `LeftSidebar` stub)
  - `components/home/RightSidebar.tsx` — replace skeleton stubs with real `<TopByType>` instances + `FeaturedTagsFallback` logic
  - `app/page.tsx` — at `<lg` only, render `<TrendingStrip />` above the feed and `<TopByType />` x2 below it (server-only conditionals using Tailwind `lg:hidden` wrappers, no `useMediaQuery`)
  - `app/api/posts/route.ts` — after `posts.insert(...)` succeeds (step 13), call `revalidateTag('posts')`. When `newTagSlugs.length > 0` (step 10), also call `revalidateTag('tags')`. Import `revalidateTag` from `'next/cache'`.
  - `tests/unit/api/posts-create.test.ts` — assert `revalidateTag` mock called with `'posts'`; assert `'tags'` called when new tags are inserted

**`revalidateTag` wiring in the publish API:**

```ts
// app/api/posts/route.ts — near the top
import { revalidateTag } from 'next/cache'

// ...inside POST handler, after step 14 (post_tags insert) succeeds:
revalidateTag('posts')
if (newTagSlugs.length > 0) revalidateTag('tags')
```

Fire `revalidateTag('posts')` AFTER the `post_tags` insert (step 14) rather than after `posts` insert (step 13), so a partial failure between the two doesn't leave the trending-tags cache invalidated with stale tag membership.

**Tests:**

- Unit: `getTrendingTags` counts per slug, sorts desc, applies window/approval filters, returns empty on db error.
- Unit: `getTopByType` filters by type, respects limit, sorts by `computeHeatScore`, returns empty on db error, skips rows with null author.
- Unit: `TrendingTagsRail` returns `null` on empty; renders one `<Link>` per tag with count.
- Unit: `TopByType` returns `null` on empty; renders title + author + likes; uses the right cache wrapper per `type` prop.
- Unit: `RightSidebar` renders `FeaturedTagsFallback` only when both caches return empty arrays.
- Unit: `posts-create.test.ts` — `revalidateTag('posts')` called on success; not called on validation failure; `revalidateTag('tags')` called when at least one new tag is created.
- E2E (extend `tests/e2e/homepage.spec.ts`): seed 1 playbook + 2 dives + posts with tags, assert the rails populate.
- E2E (extend `tests/e2e/mobile.spec.ts`): at 800px viewport, `TrendingStrip` is present, scrollable, has 5 chips; top playbooks + dives sections render below the feed.

**Acceptance:**

- All unit + E2E tests green.
- Publishing a new post via `POST /api/posts` followed by a fresh request to `/` shows the new post counted in the trending-tags rail within the request (cache invalidated).
- Right sidebar in a zero-corpus dev DB shows `FeaturedTagsFallback`.

**Out of scope for Phase B:**

- `/trending` route.
- Polish (heading micro-styles, focus rings, etc. — pick those up in Phase C).

**Dependencies:** Phase A merged to `develop`.

---

## Phase C — `/trending` route + polish + risk tests

**PR size:** S–M. ~350 LoC. Lands the new global route, hooks it into the left nav, and adds the targeted tests that catch the risks called out in issue #54.

**Branch:** `feat/home-discovery-rails-trending` off the merged Phase-B commit on `develop`. **PR target:** `develop`.

**Files:**

- **Create:**
  - `app/trending/page.tsx` — heat-ranked global feed using `HomeShell` + a heat-ranked variant of `FeedList`
  - `tests/e2e/trending.spec.ts` — `/trending` returns 200, renders heat-ranked feed, accessible
- **Modify:**
  - `tests/e2e/discovery.spec.ts` — add coverage for the `/trending` link in the left nav
  - `tests/e2e/homepage.spec.ts` — add a cache-invalidation E2E (publish via the API, fetch `/`, assert the new post is reflected in the trending-tags rail without waiting for the 10-min TTL)
  - `app/page.tsx` — minor polish only (no behavior change)

**`/trending` page shape:**

```tsx
// app/trending/page.tsx
import Link from 'next/link'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { HomeShell } from '@/components/home/HomeShell'
import { LeftSidebar } from '@/components/home/LeftSidebar'
import { RightSidebar } from '@/components/home/RightSidebar'
import { PostCardSkeleton } from '@/components/skeleton/PostCardSkeleton'
import { TrendingFeed } from '@/components/home/TrendingFeed' // new — heat-ranked variant of FeedList

export const metadata: Metadata = {
  title: 'Trending',
  description: 'What people are reading this week on agentlab.',
  alternates: { canonical: '/trending' },
}

export default async function TrendingPage() {
  const session = await getSession()
  const viewerId = session?.user?.id ?? null
  return (
    <HomeShell
      left={<LeftSidebar />}
      right={<RightSidebar />}
      center={
        <main id="main-content" className="home-feed">
          <header className="home-feed__header">
            <h1 className="home-feed__title">Trending</h1>
            <p className="home-feed__tagline">What people are reading this week.</p>
          </header>
          <Suspense fallback={<PostCardSkeleton count={5} />}>
            <TrendingFeed viewerId={viewerId} />
          </Suspense>
          <p className="home-feed__more">
            <Link href="/latest">See newest first →</Link>
          </p>
        </main>
      }
    />
  )
}
```

**`TrendingFeed` shape:** a 7-day-windowed variant of `FeedList` that reads via `shortlistByHeat` from `lib/feed/shortlist.ts`, scores via `computeHeatScore`, and renders the same `PostCard` list. The implementer should factor the existing `FeedList` from `app/page.tsx` into a shared component if doing so doesn't bloat the diff; otherwise duplicate the hydration block and refactor in a follow-up.

**Cache-invalidation E2E test (the linchpin for Risk 1):**

```ts
// tests/e2e/homepage.spec.ts — new test
test('publishing a new post immediately invalidates the trending-tags rail', async ({ page, request }) => {
  // 1. visit / and capture the trending-tags counts (or absence)
  // 2. POST /api/posts with a new playbook tagged with a known slug ('security')
  // 3. visit / again
  // 4. assert the trending-tags rail shows 'security' with count >= 1
  //    AND the new post appears in the Top Playbooks rail
})
```

Without this test, a future refactor that forgets `revalidateTag('posts')` would silently introduce a 10-minute staleness window — exactly Risk 1.

**Acceptance:**

- `/trending` returns 200 and renders heat-ranked posts.
- All E2E specs green including the new cache-invalidation test.
- Issue #54 closeable.

**Out of scope for Phase C:**

- Promoting the shell to `/latest`, `/tag/[slug]`, `/search`.
- Adding `revalidateTag` to the post-edit or post-delete handlers (deferred — call it out as a follow-up issue).

**Dependencies:** Phase B merged to `develop`.

---

## Cross-phase test matrix

Single table summarizing all test additions across phases for easy auditing.

| Phase | Layer | What | File |
|---|---|---|---|
| A | Unit | `HomeShell` renders all three named slots with correct aria | `tests/unit/components/home/home-shell.test.tsx` |
| A | Unit | `LeftNav` active route + auth gating | `tests/unit/components/home/left-nav.test.tsx` |
| A | E2E | Shell visible at xl, collapses at lg, single-col at sm | extend `tests/e2e/homepage.spec.ts`, `tests/e2e/mobile.spec.ts` |
| A | A11y | `/` axe sweep with new shell — zero serious/critical | extend `tests/e2e/a11y.spec.ts` |
| B | Unit | `getTrendingTags` shape, ordering, window/approval filter, empty | `tests/unit/feed/trending-tags.test.ts` |
| B | Unit | `getTopByType` filters by type, respects limit, sorts by heat | `tests/unit/feed/top-by-type.test.ts` |
| B | Unit | `TrendingTagsRail` null on empty / renders on populated | `tests/unit/components/home/trending-tags-rail.test.tsx` |
| B | Unit | `TopByType` null on empty / renders | `tests/unit/components/home/top-by-type.test.tsx` |
| B | Unit | `RightSidebar` shows fallback only when both rails empty | `tests/unit/components/home/right-sidebar.test.tsx` |
| B | Unit | `FeaturedTagsFallback` renders 8 starter tags | `tests/unit/components/home/featured-tags-fallback.test.tsx` |
| B | Unit | Publish API calls `revalidateTag('posts')` (+ `'tags'` when new) | extend `tests/unit/api/posts-create.test.ts` |
| B | E2E | Trending tags rail and top-by-type rails populate with seed | extend `tests/e2e/homepage.spec.ts` |
| B | E2E | `TrendingStrip` visible + scrollable at <lg; rails appear below feed | extend `tests/e2e/mobile.spec.ts` |
| C | E2E | `/trending` returns 200 + heat-ranked feed | `tests/e2e/trending.spec.ts` |
| C | E2E | Left-nav `/trending` link reachable and marks itself active | extend `tests/e2e/discovery.spec.ts` |
| C | E2E | **Cache-invalidation:** publish → next request shows new post in rails | extend `tests/e2e/homepage.spec.ts` |
| C | A11y | `/trending` covered in axe sweep | extend `tests/e2e/a11y.spec.ts` |

---

## Risks

From issue #54 + the spec. Each risk has a specific mitigation owned by a specific phase.

**Risk 1. Cache invalidation drift.** If the publish API forgets `revalidateTag('posts')`, the trending modules can be up to 10 minutes stale on prod (depending on TTL). Workers under deadline pressure routinely drop "boring" plumbing like cache invalidation when refactoring.
- **Owner:** Phase B (wires `revalidateTag` into `app/api/posts/route.ts`).
- **Mitigation 1:** unit test in `tests/unit/api/posts-create.test.ts` asserts the mock is called with `'posts'` (and `'tags'` when new) on successful insert.
- **Mitigation 2:** E2E test in Phase C (`tests/e2e/homepage.spec.ts`) publishes a new post via the API and asserts the new tag appears in the trending-tags rail on the next request — without sleeping for the TTL.

**Risk 2. Suspense waterfall — `HomeShell` becoming async.** A drive-by future change adds `await` somewhere in `HomeShell` (e.g., to centralize `getSession`), defeating streaming.
- **Owner:** Phase A.
- **Mitigation:** `HomeShell` is declared as a non-async function in TypeScript and a unit test asserts `typeof HomeShell === 'function'` returns a non-promise rendering (in practice, just exercising the test render harness without `await`). Commit message and component docstring call out the constraint loudly.

**Risk 3. Empty-state cascade at launch.** Brand-new prod DB has zero playbooks and zero dives; the right sidebar with two null `TopByType` cards looks broken.
- **Owner:** Phase B.
- **Mitigation:** `FeaturedTagsFallback` triggered by the `bothEmpty` check in `RightSidebar`. Unit test in `tests/unit/components/home/right-sidebar.test.tsx` asserts the fallback renders only when both rails are empty (not when only one is).

**Risk 4. `/trending` vs `/latest` overlap confusion at low corpus.** With <30 posts in the system, both routes look almost identical because the heat score is dominated by recency.
- **Owner:** Phase C.
- **Mitigation:** distinct H1 + tagline copy on each page (per OPC-10). `/trending` is the linked one in the left nav; `/latest` is the footer "See all posts →" target. Document the difference in the PR body of Phase C.

**Risk 5. Right-rail center-squeeze at exactly `xl` (1280px).** Math: `1280 − 200 − 280 − gaps ≈ 770px`; center caps at 672px so ~100px is "dead" between the center column and the right rail.
- **Owner:** Phase A.
- **Mitigation:** visual sanity-check at exactly 1280px during PR review. The cap is intentional (reading width is more important than filling pixels), but the gap should not look glaring. If it does, reduce the column gap from 32px to 24px in the Tailwind config.

**Risk 6. First introduction of `unstable_cache` to the repo.** Nobody else on the team has used the API in this codebase. Risk of misuse — wrong key shape, leaking per-viewer state into a shared cache, etc.
- **Owner:** Phase B.
- **Mitigation:** all `unstable_cache` calls live in a single file (`lib/feed/discovery-cache.ts`) with the closure-over-config pattern (zero runtime args → key collisions impossible). PR description includes a paragraph explaining the choice. Reviewer (operator) gates merge on agreeing with the pattern.

---

## Rollout

- All three phases ship through the standard `develop → main` flow. Phase A → B → C are merged in order; **no phase merges into another phase's branch** — each is sequential against `develop`.
- No feature flag. Each phase is additive and falls back to empty cleanly if a rail errors. Phase A's stub right sidebar shows skeletons forever (intentional) until Phase B lands.
- No DB migration in any phase. All queries run over existing tables.
- After Phase C merges, close issue #54.
- The follow-up issues to file (do NOT include in any phase):
  - "Add `revalidateTag('posts')` to post-edit and post-delete handlers" — Risk 1 follow-through for the edit/delete paths.
  - "Promote three-column shell to `/latest`, `/tag/[slug]`, `/search`" — deferred per issue #54 out-of-scope list.
  - "LeftNav: add `Settings` link?" — only if OPC-3 default is reversed by operator feedback.
  - "Trending-strip paging arrows on mobile" — only if OPC-5 friction shows up in usage.

---

**End of plan.**

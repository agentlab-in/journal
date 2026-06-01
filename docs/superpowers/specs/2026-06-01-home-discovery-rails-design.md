# Home discovery rails — design

**Date:** 2026-06-01
**Status:** design — awaiting user spec approval
**Slot:** v1.1 (post-launch). Does NOT block Phase 15 launch.

## Problem

The home `/` route currently renders a single-column 672px-wide heat-ranked feed (`app/page.tsx`). It does the For-You job, but offers nothing about *where to go next* — no trending topics, no showcase of the long-form content (playbooks / deep dives) that the brand leans on, no persistent nav surface for repeat visitors.

The locked v1 spec (`project_agentlab_v1_choices.md:47`) describes the homepage as **"three-column 'For You / Playbooks / Deep Dives' + a mixed heat-ranked feed"** — never implemented. This spec retires that gap by interpreting the locked decision as **feed (center) + showcase rail (right)**, plus a primary-nav sidebar (left).

## Scope (v1.1)

Three-column shell on `/` only. Other feed routes (`/latest`, `/tag/[slug]`, `/search`) stay single-column for now; promote the shell to them later if it works.

**Ships:**
- Left sidebar: primary nav list + trending tags rail (top 5, 7-day window)
- Right sidebar: Top Playbooks this week (3) + Top Deep Dives this week (3) + Featured tags fallback
- New route `/trending` — global heat-ranked feed, anon-readable, linked from left nav
- Mobile / sub-`lg` collapse behavior — sidebars hide, trending tags become a horizontal strip above the feed

**Does NOT ship** (deferred to v1.2+):
- Who-to-follow (needs suggestion algo + meaningful user corpus)
- Active discussions / hot comments (needs comment volume)
- Mini-profile / user-stats widget (redundant with the avatar dropdown + profile page stats)
- Drafts as a nav route — locked v1 keeps drafts in localStorage only (no server-side list to render)

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| `/trending` as new route or `/latest?sort=trending` alias? | **New route** | Clean mental model, separately linkable, easy to alias later if we change our mind. |
| Featured-tags fallback when rails are empty? | **Yes** | At launch corpus 3 of 4 modules may return zero. Featured tags (curated starter set from v1 choices) avoid the "broken sidebar" perception. |
| v1 (blocking) or v1.1 (post-launch)? | **v1.1** | The user is at Phase 14 complete, one step from Phase 15 launch. Discoverability is enhancement, not a launch blocker. |
| Component library (shadcn / Radix)? | **No** | Locked brand decision: mono everywhere, no generic component-library aesthetic. |
| Emoji icons in left nav? | **No** | Same brand reason. Text-only labels. |

## Architecture

The home page composes a server-side three-column shell. Each sidebar module wraps in its own `<Suspense>` boundary so a slow query for trending tags does not block the playbook rail or the main feed. The shell paints first; modules stream in independently.

```
app/page.tsx
└── HomeShell                    server, no state, 3-col grid wrapper
    ├── LeftSidebar              server
    │   ├── <nav> LeftNav        client (usePathname for active route)
    │   └── <Suspense> TrendingTagsRail   server, async
    ├── FeedList                 existing — already in its own Suspense
    └── RightSidebar             server
        ├── <Suspense> TopByType type=playbook   server, async
        └── <Suspense> TopByType type=dive       server, async
```

Avatar dropdown + Write CTA stay in the top nav (`components/layout/Nav.tsx`) so they remain accessible on non-home routes that do not have the shell.

## Components

### `HomeShell` — `components/home/HomeShell.tsx`
Server component, no client code. CSS-grid wrapper.

```ts
interface HomeShellProps {
  viewerId: string | null
  children: ReactNode  // the FeedList
}
```

### `LeftSidebar` — `components/home/LeftSidebar.tsx`
Server. Renders `LeftNav` + `TrendingTagsRail` (the latter inside its own Suspense). No data fetching itself. No props — `LeftNav` is self-contained (see below).

### `LeftNav` — `components/home/LeftNav.tsx`
Client component. Self-contained: reads `usePathname()` for active-route highlight AND `useSession()` for auth-gated items. **Takes no props** — this is intentional so the same component can be rendered both inside the desktop sidebar and inside the top nav (mobile/lg fallback) without a parent having to plumb session state into both render sites.

Items:
- Home (`/`) — always visible
- Trending (`/trending`) — always visible
- All tags (`/tags`) — always visible
- Bookmarks (`/bookmarks`) — only when authenticated
- Profile (`/{username}`) — only when authenticated; username pulled from session

```ts
// No props.
export function LeftNav(): JSX.Element
```

Trade-off accepted: calling `useSession()` inside `LeftNav` means each render site re-subscribes to the NextAuth context. The existing `AuthProvider` wraps the whole tree so this is a context read, not a new fetch — cost is negligible.

### `TrendingTagsRail` — `components/home/TrendingTagsRail.tsx`
Server, async. Awaits `cachedTrendingTags()`. Returns `null` when zero rows (no empty placeholder).

Renders a list of `<Link href={'/tag/' + slug}>` items, each showing `#name` + a muted count.

### `RightSidebar` — `components/home/RightSidebar.tsx`
Server. Composes two `TopByType` instances inside their own Suspense boundaries.

```tsx
<aside aria-label="Showcase">
  <Suspense fallback={<RailSkeleton />}>
    <TopByType type="playbook" />
  </Suspense>
  <Suspense fallback={<RailSkeleton />}>
    <TopByType type="dive" />
  </Suspense>
  {/* fallback rendered server-side when both above return null */}
</aside>
```

### `TopByType` — `components/home/TopByType.tsx`
Server, async, generic.

```ts
interface TopByTypeProps {
  type: 'playbook' | 'dive'
  days?: number   // default 7
  limit?: number  // default 3
}
```

Awaits the cached query. Renders the section heading + list of `<Link>` titles with author handle + like count. Returns `null` on empty.

### `FeaturedTagsFallback` — `components/home/FeaturedTagsFallback.tsx`
Server. Renders the curated starter-tag list from `project_agentlab_v1_choices.md:49` (`security`, `local-first`, `orchestration`, `memory`, `evals`, `tooling`, `prompting`, `multi-agent`) only when both `TopByType` rails return null. Heading: "Starter topics".

### `RailSkeleton` — `components/skeleton/RailSkeleton.tsx`
3–4 stub rows matching the existing `PostCardSkeleton` visual vocabulary. `aria-busy="true"` on the wrapper.

## Data

### `getTrendingTags` — `lib/feed/trending-tags.ts`

```ts
export async function getTrendingTags(
  db: SupabaseClient,
  windowDays: number = 7,
  limit: number = 5,
): Promise<Array<{ slug: string; name: string; count: number }>>
```

SQL shape:
```sql
SELECT t.slug, t.name, COUNT(pt.post_id) AS count
FROM post_tags pt
JOIN posts p   ON p.id = pt.post_id
JOIN tags  t   ON t.slug = pt.tag_slug
WHERE p.published_at > now() - (windowDays || ' days')::interval
  AND p.deleted_at IS NULL
  AND t.approved = TRUE
GROUP BY t.slug, t.name
ORDER BY count DESC
LIMIT limit
```

### `getTopByType` — `lib/feed/top-by-type.ts`

```ts
export async function getTopByType(
  db: SupabaseClient,
  type: 'playbook' | 'dive',
  windowDays: number = 7,
  limit: number = 3,
): Promise<Array<TopPostRow>>
```

Reuses `computeHeatScore` from `lib/heat.ts`. Pre-filters to `published_at > now() - interval`, `type = $type`, `deleted_at IS NULL`. Returns rows shaped for the rail UI (`id, title, slug, type, author_username, author_display_name, like_count`).

### Caching

Both functions wrapped in `unstable_cache` with tag-based invalidation:

```ts
const cachedTrendingTags = unstable_cache(
  () => getTrendingTags(adminDb, 7, 5),
  ['trending-tags-v1'],
  { revalidate: 600, tags: ['posts', 'tags'] },
)
const cachedTopPlaybooks = unstable_cache(
  () => getTopByType(adminDb, 'playbook', 7, 3),
  ['top-playbooks-7d-v1'],
  { revalidate: 600, tags: ['posts'] },
)
const cachedTopDives = unstable_cache(
  () => getTopByType(adminDb, 'dive', 7, 3),
  ['top-dives-7d-v1'],
  { revalidate: 600, tags: ['posts'] },
)
```

- `revalidate: 600` — re-fetch at most every 10 minutes per node
- `tags: ['posts']` / `['posts', 'tags']` — cache keys invalidated immediately on publish

**New responsibility for the publish API** (`app/api/posts/route.ts`): after a successful insert, call `revalidateTag('posts')` (and `revalidateTag('tags')` when tag membership changes). Covered by an added unit test.

## Empty states

| Module | Empty data | Behavior |
|---|---|---|
| Trending tags rail | No tags with posts in last 7 days | Module returns `null` — entire section hidden |
| Top Playbooks | No playbooks published in last 7 days | Module returns `null` |
| Top Deep Dives | No dives published in last 7 days | Module returns `null` |
| Right sidebar | Both `TopByType` returned null | `FeaturedTagsFallback` renders — curated 8 starter tags |
| Left sidebar | (nav always renders) | n/a |

Principle: show real signal or hide cleanly. Never pad with dummy content.

## Responsive

| Viewport | Shape | Behavior |
|---|---|---|
| `xl` (≥1280px) | 3-col `200px · 1fr · 280px` | Full layout as designed. Center column max-width capped at 672px regardless — excess goes to the rails. |
| `lg` (1024–1279px) | 2-col `1fr · 260px` | Left sidebar collapses. Nav items merge into top nav as plain links (`lg:inline-flex` toggle). Trending tags rail moves into the right rail above Top Playbooks. |
| <`lg` (≤1023px) | Single column | Both rails hidden. Trending tags become a horizontally scrollable strip above the feed (`.trending-strip`). Top Playbooks + Top Deep Dives append as collapsible sections after the feed. |

Mobile-nav approach for the LeftNav items below `lg`: **single source of truth — `LeftNav` is rendered in both the sidebar and the top nav, CSS-toggled by breakpoint.** No bottom-tab bar in v1.1.

## Accessibility

- `<aside aria-label="Primary navigation">` for left sidebar
- `<aside aria-label="Showcase">` for right sidebar
- `<nav aria-label="Section navigation">` inside `LeftNav`
- `aria-current="page"` on the active route in `LeftNav`
- Each module has a semantic `<h2>` (visually styled as the existing `.rail-heading` uppercase micro-label). Document outline stays `h1` (page title) → `h2` (sections) → no skipped levels — axe `heading-order` passes.
- Skeleton states use `aria-busy="true"` on the Suspense fallback wrapper
- Mobile trending strip: `role="list"` and `aria-label="Trending tags"`
- All sidebar links pass through the existing global `:focus-visible` ring — no new focus styles needed
- Reduced motion: skeleton shimmer respects `prefers-reduced-motion: reduce` per the existing pattern in `app/globals.css:229-240`

## Testing

Mirrors existing patterns in `tests/`.

| Layer | What | File |
|---|---|---|
| Unit (data) | `getTrendingTags` returns correct shape, ordering, window filter | `tests/unit/feed/trending-tags.test.ts` |
| Unit (data) | `getTopByType` filters by type, respects limit, scores via `computeHeatScore` | `tests/unit/feed/top-by-type.test.ts` |
| Unit (component) | `TrendingTagsRail` returns `null` on empty data; renders link+count on populated | `tests/unit/components/home/trending-tags-rail.test.tsx` |
| Unit (component) | `TopByType` returns `null` on empty; renders titles + author + likes | `tests/unit/components/home/top-by-type.test.tsx` |
| Unit (component) | `LeftNav` marks active route with `aria-current="page"`; hides auth-only items when `viewerId` null | `tests/unit/components/home/left-nav.test.tsx` |
| Unit (component) | `FeaturedTagsFallback` renders the curated 8 starter tags | `tests/unit/components/home/featured-tags-fallback.test.tsx` |
| Unit (cache) | Publish API calls `revalidateTag('posts')` on successful insert | extend `tests/unit/api/posts-create.test.ts` |
| E2E | Home (`/`) renders shell + at least the trending tags rail + one playbook (seeded fixtures) | extend `tests/e2e/homepage.spec.ts` |
| E2E | `/trending` route returns 200, renders heat-ranked feed | extend `tests/e2e/discovery.spec.ts` |
| E2E (mobile) | At <1024px viewport: sidebars hidden, trending strip visible, top-nav has nav links | extend `tests/e2e/mobile.spec.ts` |
| A11y | Home (anon + dark) — axe zero serious/critical violations | `tests/e2e/a11y.spec.ts` (already iterates `/`, will auto-cover) |

## Risks

1. **Cache invalidation drift.** If the publish API forgets `revalidateTag('posts')`, the trending modules can be 10 minutes stale. Mitigation: ship the `revalidateTag` call as part of this work, with a unit test asserting it fires.

2. **Suspense waterfall.** If `HomeShell` itself becomes async (e.g., awaits session) before reaching its inner Suspense boundaries, the streaming benefit is lost. Mitigation: `HomeShell` stays sync; `viewerId` is resolved once at the page level (already cheap, JWT-decode) and passed in via props.

3. **Empty-state cascade at launch.** When 3 of 4 modules return null, the sidebars can look broken. Mitigation: `FeaturedTagsFallback` (risk specifically called out as decision above).

4. **`/trending` vs `/latest` overlap confusion at low corpus.** They look similar with few posts. Mitigation: distinct copy on each (`Latest = "Newest first."` vs `Trending = "What people are reading right now."`); only Trending is linked from the left nav; Latest stays linkable from the home "See all posts →" footer.

5. **Center column squeeze in low-resolution `xl`.** At exactly 1280px the math is 1280 − 200 − 280 − gaps = ~770px for center, then capped to 672px. The leftover ~100px becomes dead space. Not actually broken — the cap is intentional — but worth a visual sanity check during implementation.

## Rollout

- Single PR, branched off `develop`. Convention: `feat/home-discovery-rails`.
- No feature flag — additive UI changes that fall back to empty cleanly. If the rails query errors, modules return `null`, no user-visible breakage.
- Migration: none. All data already exists in `posts` and `post_tags`.
- Deploys via the existing `develop → main` flow. After merge, lands on `dev.agentlab.in` first; promotes to prod with the next normal merge.

## Out of scope (deferred to later phases)

- **Promoting the shell to other feed pages** (`/latest`, `/tag/[slug]`, `/search`) — wait until the home version proves out.
- **Who-to-follow.** Needs corpus + suggestion algorithm. v1.2+.
- **Hot discussions / active comment threads.** Needs comment volume. v1.2+.
- **Mini-profile widget.** Redundant with avatar dropdown + profile page stats. Don't ship.
- **Drafts as a nav route.** Blocked by v1 locked decision (drafts are localStorage-only, no server-side list). Revisit if/when server-side draft sync ships in a paid tier.
- **Bottom-tab mobile nav.** Single-source LeftNav rendered into both sidebar and top-nav is enough for v1.1.
- **Personalized "For You" ranking** beyond the existing tag-affinity heat score. Real personalization is post-v1 per the locked decisions.

## Open questions resolved during brainstorming

| Question | Resolution |
|---|---|
| Three-column vs feed + right rail vs do-nothing? | Three-column. Left nav + trending tags on the left; Top Playbooks + Top Deep Dives on the right. |
| Which sidebar modules in v1.1 scope? | Left nav, trending tags, top playbooks, top dives. Defer who-to-follow, hot discussions, mini-profile. |
| `/trending` route shape? | New route, heat-ranked, anon-readable. |
| Empty-state fallback? | `FeaturedTagsFallback` renders only when both `TopByType` modules return null. |
| Ship blocker for launch? | No — v1.1 slot. |
| Component library? | No — locked brand. |
| Emoji icons in nav? | No — locked brand. |

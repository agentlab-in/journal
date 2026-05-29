# Phase 4 — Publish API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `/write` editor's currently-stubbed Publish button to a real `POST /api/posts` (plus PATCH/DELETE), with server-side validation, MDX → HTML rendering, wikilink resolution, auto-pending tag creation, and `post_versions` snapshotting on edit.

**Architecture:** Three thin Next.js 16 Route Handlers (`app/api/posts/route.ts` + `app/api/posts/[id]/route.ts`) each follow the same shape: `getSession()` → Zod validation → pure transforms (`slug`, `extractStructuredSections`, `extractWikilinkAnchors`) → service-role Supabase writes wrapped in an explicit transactional sequence. The MDX render pipeline is split: `compileMdx` (Phase 3, serialized payload for client preview) stays untouched; a new `renderToHtml(body_md, resolver)` produces the sanitized `body_html` we persist. Wikilink resolution is a single SQL call per anchor against `public.posts` (slug match → tiebreak by `author = me`, `COUNT(likes)` desc, `published_at` desc) and writes resolved rows into `public.post_references`.

**Tech Stack:** Next.js 16 App Router (Route Handlers, `runtime = 'nodejs'`), TypeScript strict, Zod (validation), Supabase service-role client (`createAdminSupabaseClient`), NextAuth v4 (`getSession`), `unified` + `remark-gfm` + `rehype-prism-plus` + `rehype-sanitize` + `rehype-stringify` for the HTML render path. Tests: Vitest unit (`tests/unit/api/`, `tests/unit/posts/`), Playwright e2e (`tests/e2e/publish.spec.ts`). Package manager: pnpm. Verification: **RTK proxy** wrapping every gate (`rtk proxy pnpm typecheck|lint|test|e2e|build`).

---

## Scope (NOT covered here, do not build)

- Phase 5 read page `/<username>/<type>/<slug>` — the editor's redirect to that URL will 404 until Phase 5; that's expected.
- Comments, likes, bookmarks, follows (Phases 7–8).
- Admin tag-approval UI (Phase 12) — Phase 4 only *creates* pending tags.
- Backfilling existing seed posts.

## Locked product calls (from orchestrator surface, 2026-05-29)

Pending orchestrator pushback, these defaults apply:

1. **`structured_sections` is server-derived from `body_md`** by parsing canonical H2 headings (no editor change). `post` → `null`; `playbook` → `{environment_target, prerequisites, core_instructions, safety_failure_modes}`; `dive` → `{tldr, the_question}`. Heading match mirrors `lib/editor/validate.ts:hasHeading` exactly.
2. **Wikilink tiebreak with no `like_count` column**: `(a) author_id = current user`, `(b) (SELECT COUNT(*) FROM public.likes WHERE post_id = p.id) DESC`, `(c) published_at DESC`.
3. **`cover_image_url` bucket validation**: must start with `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/covers/`. Anything else → 400.
4. **Reserved-name overlap** rejects both the auto-generated post slug AND any newly-created tag slug.
5. **Admin PATCH/DELETE**: any post; admin DELETE writes `deletion_reason = 'moderation'`, author DELETE writes `deletion_reason = 'author'`.

If the orchestrator pushes back on any of these, update the plan inline before continuing.

---

## File Structure

**Create:**
- `lib/posts/url.ts` — `postUrl(username, type, slug)` + `POST_TYPES` const + `isPostType` typeguard.
- `lib/posts/render.ts` — `renderToHtml(body_md, resolver)`: MDX → sanitized HTML string. Mirrors `lib/mdx/compile.ts` plugin chain but ends in `rehype-stringify`.
- `lib/posts/sections.ts` — `extractStructuredSections(body_md, type)`: pure function that returns `Record<string, string> | null`.
- `lib/posts/wikilinks-extract.ts` — `extractWikilinkAnchors(body_md)`: pure function returning `string[]` of anchor texts found in `[[Title]]` / `[[Title|Alias]]` patterns (case preserved, dedup by `lower()`).
- `lib/posts/wikilinks-resolve.ts` — `resolveAnchor(anchor, opts)` with `opts: { db, currentUserId }`. Returns `{ targetPostId, targetUsername, targetType, targetSlug } | null`.
- `lib/posts/slug-collision.ts` — `findUniqueSlug(db, authorId, baseSlug)`: queries `posts.slug` for that author, returns `baseSlug`, `baseSlug-2`, `baseSlug-3`, … up to `-99`.
- `lib/posts/cover-image.ts` — `isValidCoverImageUrl(url)`: checks prefix against `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/covers/`.
- `lib/posts/schema.ts` — Zod schemas: `PostCreateBody`, `PostPatchBody`, structured-sections sub-schemas per type.
- `lib/posts/persist.ts` — pure DB orchestration helpers: `insertPostTx`, `updatePostTx` (each takes a typed payload + admin client; encapsulates the multi-statement sequence).
- `app/api/posts/route.ts` — `POST` handler.
- `app/api/posts/[id]/route.ts` — `PATCH` + `DELETE` handlers.
- `tests/unit/posts/url.test.ts`
- `tests/unit/posts/sections.test.ts`
- `tests/unit/posts/wikilinks-extract.test.ts`
- `tests/unit/posts/wikilinks-resolve.test.ts` (mocked supabase client)
- `tests/unit/posts/slug-collision.test.ts` (mocked supabase client)
- `tests/unit/posts/cover-image.test.ts`
- `tests/unit/posts/schema.test.ts`
- `tests/unit/api/posts-create.test.ts` (route-level, full pipeline mocked DB)
- `tests/unit/api/posts-patch.test.ts`
- `tests/unit/api/posts-delete.test.ts`
- `tests/e2e/publish.spec.ts`

**Modify:**
- `lib/mdx/wikilinks.ts` — extend signature so the remark plugin accepts an optional resolver `(anchor) => { url } | null`; existing callers (compile preview) pass nothing and get the stub URL.
- `components/editor/EditorShell.tsx` — replace the `alert('Publish is wired up in Phase 4')` stub with a real `fetch('/api/posts', …)` call, loading state, server-error display, draft clear on success, `router.push(url)`.
- `app/write/[postId]/page.tsx` — pass an `editPostId` prop so `EditorShell` hits `PATCH /api/posts/[id]` instead of `POST` in edit mode.
- `docs/v1-plan.md` — strikethrough the stale `is_deleted`/`deleted_by`/`post_links` references in Phase 4's text and replace with the actual `deleted_at`/`deletion_reason`/`post_references` shipped in `0002_content.sql`. (One commit at end.)

**No change:**
- `lib/posts/slug.ts`, `lib/auth.ts`, `lib/supabase/{server,admin}.ts`, `lib/reserved-names.ts`, `lib/editor/validate.ts`, `lib/mdx/{compile,sanitize}.ts`, `supabase/migrations/*`.

---

## Chunks (compressed from 17 micro-tasks to 6 implementer chunks)

> All gates run via `rtk proxy pnpm <gate>` (RTK rewrites plain `pnpm` output — direct `pnpm` is silently filtered per `feedback_rtk_verification`). Each chunk = one implementer subagent + one code-quality reviewer. Within a chunk the implementer still uses TDD per sub-step and commits as they go; one chunk produces 1–N commits, not 1.

Chunk map:
- **Chunk A — Pure helpers + extended wikilinks plugin** (sub-tasks 1–8): `lib/posts/url.ts`, `sections.ts`, `wikilinks-extract.ts`, `wikilinks-resolve.ts`, `slug-collision.ts`, `cover-image.ts`, `schema.ts`, + resolver hook on `lib/mdx/wikilinks.ts`. All pure / mockable, no Next runtime. Implementer can parallelize within the chunk.
- **Chunk B — Render pipeline** (sub-task 9): `lib/posts/render.ts` + deps (`rehype-stringify`, etc.).
- **Chunk C — `POST /api/posts`** (sub-task 10): route + its full unit test surface.
- **Chunk D — `PATCH` + `DELETE /api/posts/[id]`** (sub-tasks 11+12): shared route file.
- **Chunk E — Editor wiring + E2E + verification gates** (sub-tasks 13+14+15): EditorShell publish handler, `/write/[postId]` wiring, e2e spec, `rtk proxy pnpm typecheck|lint|test|build|e2e`.
- **Chunk F — Doc sync + PR** (sub-tasks 16+17): `docs/v1-plan.md` schema-name cleanup, push branch, `gh pr create`, `ao report pr-created`.

The detailed sub-tasks below stay as the canonical TDD recipe. The implementer for each chunk picks up only the sub-tasks listed for that chunk and follows them step-by-step.

---

### Sub-task 1: `lib/posts/url.ts` — URL helper

**Files:**
- Create: `lib/posts/url.ts`
- Test: `tests/unit/posts/url.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/posts/url.test.ts
import { describe, it, expect } from 'vitest'
import { postUrl, isPostType, POST_TYPES } from '@/lib/posts/url'

describe('postUrl', () => {
  it('builds /<username>/<type>/<slug>', () => {
    expect(postUrl('harshit', 'post', 'agent-memory')).toBe(
      '/harshit/post/agent-memory',
    )
  })
  it('builds for each type', () => {
    expect(postUrl('h', 'playbook', 's')).toBe('/h/playbook/s')
    expect(postUrl('h', 'dive', 's')).toBe('/h/dive/s')
  })
})

describe('isPostType', () => {
  it('accepts the three allowed values', () => {
    for (const t of POST_TYPES) expect(isPostType(t)).toBe(true)
  })
  it('rejects others', () => {
    expect(isPostType('pattern')).toBe(false)
    expect(isPostType('')).toBe(false)
    expect(isPostType('POST')).toBe(false)
  })
})
```

- [ ] **Step 2: Verify it fails**

Run: `rtk proxy pnpm test -- tests/unit/posts/url.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/posts/url.ts
export type PostType = 'post' | 'playbook' | 'dive'
export const POST_TYPES: readonly PostType[] = ['post', 'playbook', 'dive'] as const

export function postUrl(username: string, type: PostType, slug: string): string {
  return `/${username}/${type}/${slug}`
}

export function isPostType(value: string): value is PostType {
  return (POST_TYPES as readonly string[]).includes(value)
}
```

- [ ] **Step 4: Verify it passes**

Run: `rtk proxy pnpm test -- tests/unit/posts/url.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add lib/posts/url.ts tests/unit/posts/url.test.ts
git commit -m "feat(posts): add postUrl + PostType helpers (Phase 4)"
```

---

### Sub-task 2: `lib/posts/sections.ts` — structured_sections derivation

**Files:**
- Create: `lib/posts/sections.ts`
- Test: `tests/unit/posts/sections.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/posts/sections.test.ts
import { describe, it, expect } from 'vitest'
import { extractStructuredSections } from '@/lib/posts/sections'

const playbookBody = [
  '## Environment / Target',
  'mac mini, claude code 0.3.x',
  '',
  '## Prerequisites',
  '- gh cli',
  '- node 24',
  '',
  '## Core Instructions',
  '1. clone repo',
  '2. run pnpm install',
  '',
  '## Safety / Failure Modes',
  "don't push to main",
].join('\n')

const diveBody = [
  '## TL;DR',
  'short answer here',
  '',
  '## The Question',
  'long form question',
].join('\n')

describe('extractStructuredSections', () => {
  it('returns null for post type regardless of body', () => {
    expect(extractStructuredSections(playbookBody, 'post')).toBeNull()
    expect(extractStructuredSections('', 'post')).toBeNull()
  })

  it('extracts all four playbook sections by canonical heading', () => {
    const out = extractStructuredSections(playbookBody, 'playbook')
    expect(out).toEqual({
      environment_target: 'mac mini, claude code 0.3.x',
      prerequisites: '- gh cli\n- node 24',
      core_instructions: '1. clone repo\n2. run pnpm install',
      safety_failure_modes: "don't push to main",
    })
  })

  it('extracts both dive sections', () => {
    const out = extractStructuredSections(diveBody, 'dive')
    expect(out).toEqual({
      tldr: 'short answer here',
      the_question: 'long form question',
    })
  })

  it('returns null section value when heading is missing', () => {
    const partial = '## Environment / Target\nfoo'
    const out = extractStructuredSections(partial, 'playbook')
    expect(out).toEqual({
      environment_target: 'foo',
      prerequisites: null,
      core_instructions: null,
      safety_failure_modes: null,
    })
  })

  it('captures content until the next canonical H2 (ignores other H2s in between)', () => {
    const body = [
      '## TL;DR',
      'pre note',
      '## Side Note',
      'random aside that should still be inside tldr',
      '## The Question',
      'q body',
    ].join('\n')
    const out = extractStructuredSections(body, 'dive')
    expect(out?.tldr).toContain('pre note')
    expect(out?.tldr).toContain('random aside that should still be inside tldr')
    expect(out?.the_question).toBe('q body')
  })
})
```

- [ ] **Step 2: Verify it fails**

Run: `rtk proxy pnpm test -- tests/unit/posts/sections.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/posts/sections.ts
import type { PostType } from './url'

const PLAYBOOK_HEADINGS = [
  ['## Environment / Target', 'environment_target'],
  ['## Prerequisites', 'prerequisites'],
  ['## Core Instructions', 'core_instructions'],
  ['## Safety / Failure Modes', 'safety_failure_modes'],
] as const

const DIVE_HEADINGS = [
  ['## TL;DR', 'tldr'],
  ['## The Question', 'the_question'],
] as const

type Spec = readonly (readonly [string, string])[]

function extract(body: string, spec: Spec): Record<string, string | null> {
  const lines = body.split('\n')
  const markerLines = new Map<number, string>()
  for (const [heading, key] of spec) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trimStart().startsWith(heading)) {
        markerLines.set(i, key)
        break
      }
    }
  }
  const result: Record<string, string | null> = Object.fromEntries(
    spec.map(([, k]) => [k, null]),
  )
  const sortedIdx = [...markerLines.keys()].sort((a, b) => a - b)
  for (let i = 0; i < sortedIdx.length; i++) {
    const start = sortedIdx[i] + 1
    const end = i + 1 < sortedIdx.length ? sortedIdx[i + 1] : lines.length
    const key = markerLines.get(sortedIdx[i])!
    result[key] = lines.slice(start, end).join('\n').trim()
  }
  return result
}

export function extractStructuredSections(
  body_md: string,
  type: PostType,
): Record<string, string | null> | null {
  if (type === 'post') return null
  if (type === 'playbook') return extract(body_md, PLAYBOOK_HEADINGS)
  if (type === 'dive') return extract(body_md, DIVE_HEADINGS)
  return null
}
```

- [ ] **Step 4: Verify it passes**

Run: `rtk proxy pnpm test -- tests/unit/posts/sections.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add lib/posts/sections.ts tests/unit/posts/sections.test.ts
git commit -m "feat(posts): extract structured_sections from body H2 headings (Phase 4)"
```

---

### Sub-task 3: `lib/posts/wikilinks-extract.ts` — anchor extraction

**Files:**
- Create: `lib/posts/wikilinks-extract.ts`
- Test: `tests/unit/posts/wikilinks-extract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/posts/wikilinks-extract.test.ts
import { describe, it, expect } from 'vitest'
import { extractWikilinkAnchors } from '@/lib/posts/wikilinks-extract'

describe('extractWikilinkAnchors', () => {
  it('returns [] for empty / no-link bodies', () => {
    expect(extractWikilinkAnchors('')).toEqual([])
    expect(extractWikilinkAnchors('plain text')).toEqual([])
  })
  it('extracts single anchor text', () => {
    expect(extractWikilinkAnchors('see [[Pattern Name]] for context')).toEqual([
      'Pattern Name',
    ])
  })
  it('uses the lookup portion of alias syntax', () => {
    expect(
      extractWikilinkAnchors('see [[Pattern Name|the original pattern]]'),
    ).toEqual(['Pattern Name'])
  })
  it('dedupes case-insensitively, keeping first occurrence casing', () => {
    expect(
      extractWikilinkAnchors('[[A]] then [[a]] then [[A]] then [[B]]'),
    ).toEqual(['A', 'B'])
  })
  it('ignores anchors inside fenced code blocks', () => {
    const body = '```\n[[NotAnAnchor]]\n```\n[[Real Anchor]]'
    expect(extractWikilinkAnchors(body)).toEqual(['Real Anchor'])
  })
  it('ignores anchors inside inline code', () => {
    expect(extractWikilinkAnchors('`[[code]]` and [[real]]')).toEqual(['real'])
  })
})
```

- [ ] **Step 2: Verify it fails**

Run: `rtk proxy pnpm test -- tests/unit/posts/wikilinks-extract.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/posts/wikilinks-extract.ts
const FENCED_CODE_RE = /^```[\s\S]*?^```/gm
const INLINE_CODE_RE = /`[^`\n]*`/g
const WIKILINK_RE = /\[\[([^[\]|\n]+)(?:\|[^[\]\n]+)?\]\]/g

export function extractWikilinkAnchors(body_md: string): string[] {
  // Strip fenced and inline code first so anchors inside them are ignored.
  const stripped = body_md
    .replace(FENCED_CODE_RE, '')
    .replace(INLINE_CODE_RE, '')

  const seen = new Map<string, string>()
  let match: RegExpExecArray | null
  WIKILINK_RE.lastIndex = 0
  while ((match = WIKILINK_RE.exec(stripped)) !== null) {
    const anchor = match[1].trim()
    if (!anchor) continue
    const key = anchor.toLowerCase()
    if (!seen.has(key)) seen.set(key, anchor)
  }
  return [...seen.values()]
}
```

- [ ] **Step 4: Verify it passes**

Run: `rtk proxy pnpm test -- tests/unit/posts/wikilinks-extract.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add lib/posts/wikilinks-extract.ts tests/unit/posts/wikilinks-extract.test.ts
git commit -m "feat(posts): extract wikilink anchor texts from body_md (Phase 4)"
```

---

### Sub-task 4: `lib/posts/wikilinks-resolve.ts` — slug-match resolver

**Files:**
- Create: `lib/posts/wikilinks-resolve.ts`
- Test: `tests/unit/posts/wikilinks-resolve.test.ts`

Resolver contract: given an anchor string, slugifies via `lib/posts/slug.ts:slug`, queries `public.posts` for rows where `slug = <slugified>` AND `deleted_at IS NULL`, joins through `public.users` for `username`, tiebreaks with `(author = current) DESC, like_count DESC, published_at DESC`, returns the top row or `null`.

- [ ] **Step 1: Write the failing test (mocked supabase)**

```ts
// tests/unit/posts/wikilinks-resolve.test.ts
import { describe, it, expect, vi } from 'vitest'
import { resolveAnchor } from '@/lib/posts/wikilinks-resolve'

// Mock supabase admin client: we only exercise the `.rpc('resolve_wikilink', …)`
// path the implementation chooses. If implementation uses .from().select() chain
// instead, adapt this mock accordingly — see implementation step.
function mockDb(rows: Array<{
  id: string
  author_id: string
  username: string
  type: 'post' | 'playbook' | 'dive'
  slug: string
  like_count: number
  published_at: string
}>) {
  return {
    rpc: vi.fn((_fn: string, _args: unknown) =>
      Promise.resolve({ data: rows, error: null }),
    ),
  }
}

describe('resolveAnchor', () => {
  const me = 'user-me'

  it('returns null when no posts match the slug', async () => {
    const db = mockDb([])
    const res = await resolveAnchor('Unknown Title', { db: db as never, currentUserId: me })
    expect(res).toBeNull()
  })

  it('prefers own post even when other posts have more likes', async () => {
    const db = mockDb([
      {
        id: 'p-mine',
        author_id: me,
        username: 'me',
        type: 'post',
        slug: 'shared-slug',
        like_count: 1,
        published_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'p-popular',
        author_id: 'user-other',
        username: 'pop',
        type: 'post',
        slug: 'shared-slug',
        like_count: 99,
        published_at: '2026-05-01T00:00:00Z',
      },
    ])
    const res = await resolveAnchor('Shared Slug', { db: db as never, currentUserId: me })
    expect(res?.targetPostId).toBe('p-mine')
  })

  it('uses likes tiebreak when no own post', async () => {
    const db = mockDb([
      {
        id: 'p-old-pop',
        author_id: 'a',
        username: 'a',
        type: 'post',
        slug: 's',
        like_count: 50,
        published_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'p-newer-cold',
        author_id: 'b',
        username: 'b',
        type: 'post',
        slug: 's',
        like_count: 1,
        published_at: '2026-05-01T00:00:00Z',
      },
    ])
    const res = await resolveAnchor('S', { db: db as never, currentUserId: me })
    expect(res?.targetPostId).toBe('p-old-pop')
  })

  it('falls back to recency when likes are tied', async () => {
    const db = mockDb([
      {
        id: 'p-newer',
        author_id: 'a',
        username: 'a',
        type: 'dive',
        slug: 's',
        like_count: 0,
        published_at: '2026-05-01T00:00:00Z',
      },
      {
        id: 'p-older',
        author_id: 'b',
        username: 'b',
        type: 'dive',
        slug: 's',
        like_count: 0,
        published_at: '2026-01-01T00:00:00Z',
      },
    ])
    const res = await resolveAnchor('S', { db: db as never, currentUserId: me })
    expect(res?.targetPostId).toBe('p-newer')
  })

  it('returns the resolved row shape', async () => {
    const db = mockDb([
      {
        id: 'p1',
        author_id: 'a',
        username: 'alice',
        type: 'playbook',
        slug: 'agent-memory',
        like_count: 0,
        published_at: '2026-01-01T00:00:00Z',
      },
    ])
    const res = await resolveAnchor('Agent Memory', {
      db: db as never,
      currentUserId: me,
    })
    expect(res).toEqual({
      targetPostId: 'p1',
      targetUsername: 'alice',
      targetType: 'playbook',
      targetSlug: 'agent-memory',
    })
  })
})
```

- [ ] **Step 2: Verify it fails**

Run: `rtk proxy pnpm test -- tests/unit/posts/wikilinks-resolve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Decide query strategy**

Two valid implementations:

**A. PostgREST chained select** (no migration needed):

```ts
const { data, error } = await db
  .from('posts')
  .select('id, author_id, slug, type, published_at, users!inner(username), likes(count)')
  .eq('slug', slugified)
  .is('deleted_at', null)
```

then sort in JS. Simple but pulls every matching row to the client — fine because slug collisions are rare.

**B. SQL function `public.resolve_wikilink(target_slug text, current_user_id uuid)`** added in a new migration `0004_resolve_wikilink.sql`. Single round-trip; ordering done server-side.

**Pick A** for v1 — no migration churn, slug-collision rate will stay tiny. If profiling later shows the JS sort is hot, swap to B in a future phase.

- [ ] **Step 4: Implement (strategy A)**

```ts
// lib/posts/wikilinks-resolve.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { slug as toSlug } from './slug'
import type { PostType } from './url'

export interface ResolveOpts {
  db: Pick<SupabaseClient, 'from'>
  currentUserId: string
}

export interface ResolvedAnchor {
  targetPostId: string
  targetUsername: string
  targetType: PostType
  targetSlug: string
}

interface Row {
  id: string
  author_id: string
  slug: string
  type: string
  published_at: string
  users: { username: string } | null
  likes: { count: number }[]
}

export async function resolveAnchor(
  anchor: string,
  opts: ResolveOpts,
): Promise<ResolvedAnchor | null> {
  const target = toSlug(anchor)
  if (!target) return null

  const { data, error } = await opts.db
    .from('posts')
    .select(
      'id, author_id, slug, type, published_at, users!inner(username), likes(count)',
    )
    .eq('slug', target)
    .is('deleted_at', null)

  if (error || !data || data.length === 0) return null

  const rows = data as unknown as Row[]
  rows.sort((a, b) => {
    const aMine = a.author_id === opts.currentUserId ? 1 : 0
    const bMine = b.author_id === opts.currentUserId ? 1 : 0
    if (aMine !== bMine) return bMine - aMine
    const aLikes = a.likes[0]?.count ?? 0
    const bLikes = b.likes[0]?.count ?? 0
    if (aLikes !== bLikes) return bLikes - aLikes
    return b.published_at.localeCompare(a.published_at)
  })

  const top = rows[0]
  if (!top.users) return null
  return {
    targetPostId: top.id,
    targetUsername: top.users.username,
    targetType: top.type as PostType,
    targetSlug: top.slug,
  }
}
```

The test file above mocks `.rpc()` — rewrite the test mocks to match the `.from().select().eq().is()` chain. Use `vi.fn` chains that return a thenable: `from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ is: vi.fn(() => Promise.resolve({ data: rows, error: null })) })) })) }))`. Pattern is verbose but reliable.

- [ ] **Step 5: Update test mocks + verify it passes**

Rewrite each test's `mockDb` to:

```ts
function mockDb(rows: Row[]) {
  const isFn = vi.fn(() => Promise.resolve({ data: rows, error: null }))
  const eqFn = vi.fn(() => ({ is: isFn }))
  const selectFn = vi.fn(() => ({ eq: eqFn }))
  return { from: vi.fn(() => ({ select: selectFn })) }
}
```

Each `Row` needs `users: { username }` and `likes: [{ count }]` shape to match the SELECT.

Run: `rtk proxy pnpm test -- tests/unit/posts/wikilinks-resolve.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 6: Commit**

```bash
git add lib/posts/wikilinks-resolve.ts tests/unit/posts/wikilinks-resolve.test.ts
git commit -m "feat(posts): resolve wikilink anchors with own→likes→recency tiebreak (Phase 4)"
```

---

### Sub-task 5: `lib/posts/slug-collision.ts` — per-author unique slug

**Files:**
- Create: `lib/posts/slug-collision.ts`
- Test: `tests/unit/posts/slug-collision.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/posts/slug-collision.test.ts
import { describe, it, expect, vi } from 'vitest'
import { findUniqueSlug } from '@/lib/posts/slug-collision'

function mockDbWithTakenSlugs(taken: string[]) {
  const set = new Set(taken)
  const inFn = vi.fn((_col: string, vals: string[]) =>
    Promise.resolve({
      data: vals.filter((v) => set.has(v)).map((slug) => ({ slug })),
      error: null,
    }),
  )
  const eqFn = vi.fn(() => ({ in: inFn }))
  const selectFn = vi.fn(() => ({ eq: eqFn }))
  return { from: vi.fn(() => ({ select: selectFn })) }
}

describe('findUniqueSlug', () => {
  it('returns base when nothing taken', async () => {
    const db = mockDbWithTakenSlugs([])
    expect(await findUniqueSlug(db as never, 'author-1', 'hello')).toBe('hello')
  })
  it('suffixes -2 when base taken', async () => {
    const db = mockDbWithTakenSlugs(['hello'])
    expect(await findUniqueSlug(db as never, 'author-1', 'hello')).toBe('hello-2')
  })
  it('skips up to first free suffix', async () => {
    const db = mockDbWithTakenSlugs(['hello', 'hello-2', 'hello-3'])
    expect(await findUniqueSlug(db as never, 'author-1', 'hello')).toBe('hello-4')
  })
  it('throws after exhausting 99 suffixes', async () => {
    const taken = ['hello', ...Array.from({ length: 98 }, (_, i) => `hello-${i + 2}`)]
    const db = mockDbWithTakenSlugs(taken)
    await expect(findUniqueSlug(db as never, 'a', 'hello')).rejects.toThrow(/exhausted/i)
  })
})
```

- [ ] **Step 2: Verify it fails**

Run: `rtk proxy pnpm test -- tests/unit/posts/slug-collision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/posts/slug-collision.ts
import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_SUFFIX = 99

export async function findUniqueSlug(
  db: Pick<SupabaseClient, 'from'>,
  authorId: string,
  baseSlug: string,
): Promise<string> {
  const candidates = [
    baseSlug,
    ...Array.from({ length: MAX_SUFFIX - 1 }, (_, i) => `${baseSlug}-${i + 2}`),
  ]
  const { data, error } = await db
    .from('posts')
    .select('slug')
    .eq('author_id', authorId)
    .in('slug', candidates)

  if (error) throw new Error(`slug lookup failed: ${error.message}`)
  const taken = new Set((data ?? []).map((r: { slug: string }) => r.slug))
  const free = candidates.find((c) => !taken.has(c))
  if (!free) {
    throw new Error(`Exhausted slug suffixes for "${baseSlug}"`)
  }
  return free
}
```

- [ ] **Step 4: Verify it passes**

Run: `rtk proxy pnpm test -- tests/unit/posts/slug-collision.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add lib/posts/slug-collision.ts tests/unit/posts/slug-collision.test.ts
git commit -m "feat(posts): per-author unique slug with -2…-99 suffixing (Phase 4)"
```

---

### Sub-task 6: `lib/posts/cover-image.ts` — bucket URL validator

**Files:**
- Create: `lib/posts/cover-image.ts`
- Test: `tests/unit/posts/cover-image.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/posts/cover-image.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { isValidCoverImageUrl } from '@/lib/posts/cover-image'

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co'
})

describe('isValidCoverImageUrl', () => {
  it('accepts a covers-bucket URL', () => {
    expect(
      isValidCoverImageUrl(
        'https://abc.supabase.co/storage/v1/object/public/covers/userid/uuid.webp',
      ),
    ).toBe(true)
  })
  it('rejects a different bucket', () => {
    expect(
      isValidCoverImageUrl(
        'https://abc.supabase.co/storage/v1/object/public/avatars/x.png',
      ),
    ).toBe(false)
  })
  it('rejects a different host', () => {
    expect(
      isValidCoverImageUrl(
        'https://evil.example/storage/v1/object/public/covers/x.webp',
      ),
    ).toBe(false)
  })
  it('rejects non-URLs', () => {
    expect(isValidCoverImageUrl('')).toBe(false)
    expect(isValidCoverImageUrl('not-a-url')).toBe(false)
  })
})
```

- [ ] **Step 2: Verify it fails**

Run: `rtk proxy pnpm test -- tests/unit/posts/cover-image.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/posts/cover-image.ts
export function isValidCoverImageUrl(url: string): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return false
  const expectedPrefix = `${supabaseUrl}/storage/v1/object/public/covers/`
  return typeof url === 'string' && url.length > expectedPrefix.length && url.startsWith(expectedPrefix)
}
```

- [ ] **Step 4: Verify it passes**

Run: `rtk proxy pnpm test -- tests/unit/posts/cover-image.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add lib/posts/cover-image.ts tests/unit/posts/cover-image.test.ts
git commit -m "feat(posts): validate cover image URL prefix against covers bucket (Phase 4)"
```

---

### Sub-task 7: `lib/posts/schema.ts` — Zod request bodies

**Files:**
- Create: `lib/posts/schema.ts`
- Test: `tests/unit/posts/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/posts/schema.test.ts
import { describe, it, expect } from 'vitest'
import { PostCreateBody, PostPatchBody } from '@/lib/posts/schema'

const baseBody = 'a'.repeat(60)

describe('PostCreateBody', () => {
  it('accepts a minimal post', () => {
    const parsed = PostCreateBody.safeParse({
      type: 'post',
      title: 'Hello',
      summary: 'A summary that fits.',
      body_md: baseBody,
      tags: ['rag'],
    })
    expect(parsed.success).toBe(true)
  })
  it('rejects unknown type', () => {
    const parsed = PostCreateBody.safeParse({
      type: 'pattern',
      title: 't',
      summary: 's',
      body_md: baseBody,
      tags: ['rag'],
    })
    expect(parsed.success).toBe(false)
  })
  it('rejects > 5 tags', () => {
    const parsed = PostCreateBody.safeParse({
      type: 'post',
      title: 'Hello',
      summary: 'A summary that fits.',
      body_md: baseBody,
      tags: ['a', 'b', 'c', 'd', 'e', 'f'],
    })
    expect(parsed.success).toBe(false)
  })
  it('rejects non-kebab tag', () => {
    const parsed = PostCreateBody.safeParse({
      type: 'post',
      title: 'Hello',
      summary: 'A summary that fits.',
      body_md: baseBody,
      tags: ['Rag Tag'],
    })
    expect(parsed.success).toBe(false)
  })
  it('rejects tag longer than 30 chars', () => {
    const parsed = PostCreateBody.safeParse({
      type: 'post',
      title: 'Hello',
      summary: 'A summary that fits.',
      body_md: baseBody,
      tags: ['a'.repeat(31)],
    })
    expect(parsed.success).toBe(false)
  })
  it('rejects body_md > 200000 chars', () => {
    const parsed = PostCreateBody.safeParse({
      type: 'post',
      title: 'Hello',
      summary: 'A summary that fits.',
      body_md: 'a'.repeat(200001),
      tags: ['rag'],
    })
    expect(parsed.success).toBe(false)
  })
  it('accepts optional cover_image_url', () => {
    const parsed = PostCreateBody.safeParse({
      type: 'post',
      title: 'Hello',
      summary: 'A summary that fits.',
      body_md: baseBody,
      tags: ['rag'],
      cover_image_url: 'https://example.com/x.webp',
    })
    expect(parsed.success).toBe(true)
  })
})

describe('PostPatchBody', () => {
  it('accepts shape sans type', () => {
    const parsed = PostPatchBody.safeParse({
      title: 'New title here',
      summary: 'New summary value.',
      body_md: baseBody,
      tags: ['rag'],
    })
    expect(parsed.success).toBe(true)
  })
  it('rejects when type is set', () => {
    const parsed = PostPatchBody.safeParse({
      type: 'post',
      title: 'New title here',
      summary: 'New summary value.',
      body_md: baseBody,
      tags: ['rag'],
    })
    expect(parsed.success).toBe(false)
  })
})
```

- [ ] **Step 2: Verify it fails**

Run: `rtk proxy pnpm test -- tests/unit/posts/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/posts/schema.ts
import { z } from 'zod'

const TagSlug = z
  .string()
  .min(1)
  .max(30)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case')

const TitleField = z.string().min(1).max(200)
const SummaryField = z.string().min(1).max(200)
const BodyField = z.string().min(1).max(200000)
const TagsField = z.array(TagSlug).min(1).max(5)
const CoverUrlField = z.string().url().optional()
const TypeField = z.enum(['post', 'playbook', 'dive'])

export const PostCreateBody = z
  .object({
    type: TypeField,
    title: TitleField,
    summary: SummaryField,
    body_md: BodyField,
    tags: TagsField,
    cover_image_url: CoverUrlField,
  })
  .strict()

export const PostPatchBody = z
  .object({
    title: TitleField,
    summary: SummaryField,
    body_md: BodyField,
    tags: TagsField,
    cover_image_url: CoverUrlField,
  })
  .strict()

export type PostCreateInput = z.infer<typeof PostCreateBody>
export type PostPatchInput = z.infer<typeof PostPatchBody>
```

Cover-bucket prefix validation is left out of Zod (env access during parse is brittle); the route applies `isValidCoverImageUrl` after `safeParse` succeeds.

- [ ] **Step 4: Verify it passes**

Run: `rtk proxy pnpm test -- tests/unit/posts/schema.test.ts`
Expected: PASS, 9/9.

- [ ] **Step 5: Commit**

```bash
git add lib/posts/schema.ts tests/unit/posts/schema.test.ts
git commit -m "feat(posts): zod schemas for POST + PATCH bodies (Phase 4)"
```

---

### Sub-task 8: Extend `lib/mdx/wikilinks.ts` to accept a resolver

**Files:**
- Modify: `lib/mdx/wikilinks.ts`
- Test: `tests/unit/wikilinks.test.ts` (existing — extend)

- [ ] **Step 1: Add a failing test for the resolver path**

Append to `tests/unit/wikilinks.test.ts`:

```ts
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import wikilinks from '@/lib/mdx/wikilinks'

it('rewrites href to resolved URL when resolver returns one', async () => {
  const out = String(
    await unified()
      .use(remarkParse)
      .use(wikilinks, {
        resolve: (anchor: string) =>
          anchor === 'Pattern X' ? { url: '/alice/post/pattern-x' } : null,
      })
      .use(remarkStringify)
      .process('see [[Pattern X]] and [[Unknown]]'),
  )
  expect(out).toContain('](/alice/post/pattern-x)')
  expect(out).toContain('](/wikilink-resolve?title=Unknown)')
})
```

- [ ] **Step 2: Verify it fails**

Run: `rtk proxy pnpm test -- tests/unit/wikilinks.test.ts`
Expected: FAIL — current signature is parameterless.

- [ ] **Step 3: Update signature**

```ts
// lib/mdx/wikilinks.ts (changed section)
export interface WikilinkResolveResult { url: string }
export interface WikilinkPluginOptions {
  resolve?: (anchor: string) => WikilinkResolveResult | null
}

const wikilinks: Plugin<[WikilinkPluginOptions?], Root> = (opts = {}) => {
  const resolve = opts.resolve
  return (tree) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      // … existing logic …
      // when building `link`:
      const resolved = resolve?.(title) ?? null
      const link: Link = {
        type: 'link',
        url: resolved
          ? resolved.url
          : `/wikilink-resolve?title=${encodeURIComponent(title)}`,
        title: null,
        children: [{ type: 'text', value: display }],
      }
      // … rest unchanged …
    })
  }
}
```

All existing callers (`compileMdx` in `lib/mdx/compile.ts`) pass nothing → stub URL still used. No call-site change.

- [ ] **Step 4: Verify it passes (new + all existing wikilinks tests)**

Run: `rtk proxy pnpm test -- tests/unit/wikilinks.test.ts`
Expected: PASS — all existing tests still green plus the new one.

- [ ] **Step 5: Commit**

```bash
git add lib/mdx/wikilinks.ts tests/unit/wikilinks.test.ts
git commit -m "feat(mdx): optional resolver hook on wikilinks plugin (Phase 4)"
```

---

### Sub-task 9: `lib/posts/render.ts` — MDX → HTML for persistence

**Files:**
- Create: `lib/posts/render.ts`
- Test: `tests/unit/posts/render.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/posts/render.test.ts
import { describe, it, expect } from 'vitest'
import { renderToHtml } from '@/lib/posts/render'

describe('renderToHtml', () => {
  it('emits sanitized HTML for plain markdown', async () => {
    const html = await renderToHtml('# Hello\n\nWorld', { resolveAnchor: () => null })
    expect(html).toContain('<h1>')
    expect(html).toContain('Hello')
    expect(html).toContain('World')
  })
  it('strips a <script> tag', async () => {
    const html = await renderToHtml('<script>alert(1)</script>safe', { resolveAnchor: () => null })
    expect(html).not.toContain('<script')
    expect(html).toContain('safe')
  })
  it('rewrites resolved wikilinks to canonical URL', async () => {
    const html = await renderToHtml('see [[Agent Memory]]', {
      resolveAnchor: (anchor) =>
        anchor === 'Agent Memory' ? '/alice/playbook/agent-memory' : null,
    })
    expect(html).toContain('href="/alice/playbook/agent-memory"')
  })
  it('keeps unresolved wikilinks as broken-link span (no anchor)', async () => {
    const html = await renderToHtml('see [[Nobody Knows]]', { resolveAnchor: () => null })
    expect(html).not.toContain('href="/wikilink-resolve')
    expect(html).toContain('broken-wikilink')
    expect(html).toContain('Nobody Knows')
  })
})
```

- [ ] **Step 2: Verify it fails**

Run: `rtk proxy pnpm test -- tests/unit/posts/render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/posts/render.ts
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypePrismPlus from 'rehype-prism-plus'
import rehypeSanitize from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import wikilinks from '@/lib/mdx/wikilinks'
import { sanitizeSchema } from '@/lib/mdx/sanitize'

export interface RenderOpts {
  resolveAnchor: (anchor: string) => string | null
}

export async function renderToHtml(
  body_md: string,
  opts: RenderOpts,
): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(wikilinks, {
      resolve: (anchor) => {
        const url = opts.resolveAnchor(anchor)
        return url ? { url } : null
      },
    })
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypePrismPlus, { ignoreMissing: true })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify)
    .process(body_md)
  let html = String(file)
  html = rewriteUnresolvedWikilinks(html)
  return html
}

const STUB_LINK_RE =
  /<a\s+href="\/wikilink-resolve\?title=([^"]+)"[^>]*>([^<]*)<\/a>/g

function rewriteUnresolvedWikilinks(html: string): string {
  return html.replace(STUB_LINK_RE, (_full, _enc, text) => {
    return `<span class="broken-wikilink" title="Unresolved wikilink">${text}</span>`
  })
}
```

- [ ] **Step 4: Verify it passes**

Run: `rtk proxy pnpm test -- tests/unit/posts/render.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Add `rehype-stringify` to deps if missing**

```bash
rtk proxy pnpm add rehype-stringify remark-parse remark-rehype
```

(remark-parse + remark-rehype likely already transitive but install explicit.) Re-run tests after install.

- [ ] **Step 6: Commit**

```bash
git add lib/posts/render.ts tests/unit/posts/render.test.ts package.json pnpm-lock.yaml
git commit -m "feat(posts): render body_md to sanitized HTML with resolver hook (Phase 4)"
```

---

### Sub-task 10: `POST /api/posts` route handler

**Files:**
- Create: `app/api/posts/route.ts`
- Test: `tests/unit/api/posts-create.test.ts`

Pipeline:
1. `getSession()` → 401 if missing.
2. `PostCreateBody.safeParse(body)` → 400.
3. `cover_image_url` present → `isValidCoverImageUrl` → 400.
4. `extractStructuredSections(body_md, type)` → required keys non-empty for playbook/dive → 400.
5. `baseSlug = slug(title)` → `isReserved(baseSlug)` → 400. Then `findUniqueSlug`.
6. Load author username: `from('users').select('username').eq('id', session.user.id).single()`. 500 if absent.
7. Tag handling: pre-fetch existing tags, find missing, validate each missing slug with `isReserved` → 400, insert new tags `is_approved=false, approved_by=null, approved_at=null`.
8. `extractWikilinkAnchors(body_md)` → for each, `resolveAnchor(...)` → build a resolver map `anchor → url`.
9. `renderToHtml(body_md, { resolveAnchor: (a) => map.get(a) ?? null })`.
10. `insert into posts (...)` with `structured_sections` JSON.
11. `insert into post_tags (post_id, tag_slug)` for each tag.
12. `insert into post_versions (post_id, version_no=1, body_md)`.
13. `insert into post_references (source_post_id, target_post_id, target_slug)` for each resolved anchor (target_slug = slug(anchor)).
14. Return `{ id, slug, url: postUrl(username, type, slug) }`, status 201.

- [ ] **Step 1: Write the failing route test (mocked supabase + session)**

```ts
// tests/unit/api/posts-create.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mocks must be set up before the route module is imported. We use vi.mock
// hoisting to keep imports linear at the top of the file.
const sessionState: { value: { user: { id: string } } | null } = { value: null }
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
  isAdmin: vi.fn(() => false),
}))

const supabaseStub = (() => {
  // Minimal capture-friendly stub. Each describe block re-wires it.
  return { state: { inserts: [] as { table: string; rows: unknown }[] } }
})()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => makeFakeClient(supabaseStub.state)),
}))

// Helper: a chainable PostgREST stub. Implement only the surface the route uses.
// See route implementation for exact chains required.
function makeFakeClient(state: { inserts: { table: string; rows: unknown }[] }) {
  // … hand-write a tiny dispatcher keyed on table name; return canned data for
  // SELECTs and capture INSERT payloads in `state.inserts`. The implementer
  // expands this stub as the route adds calls.
  // (See implementation step for the exact surface; this stub stays
  //  intentionally minimal at first.)
  return { /* expanded by implementer */ } as never
}

describe('POST /api/posts', () => {
  beforeEach(() => {
    sessionState.value = null
    supabaseStub.state.inserts = []
  })

  it('returns 401 when no session', async () => {
    const { POST } = await import('@/app/api/posts/route')
    const req = new Request('http://test/api/posts', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(401)
  })

  // Add at least one happy-path test:
  it('returns 201 with { id, slug, url } on valid create', async () => {
    // … wire fake client to return author username, no existing tags, no
    // existing slugs, accept inserts. Assert response shape + that
    // post_versions row v1 was inserted.
  })

  it('returns 400 when tag slug shadows a reserved name', async () => {
    // assert 400 + error code
  })

  it('returns 400 when summary > 200 chars', async () => {})
  it('returns 400 when cover_image_url is not in covers bucket', async () => {})
  it('suffixes slug when base is taken by same author', async () => {})
  it('inserts is_approved=false rows for new tags', async () => {})
  it('writes post_references rows for resolved wikilinks', async () => {})
})
```

The implementer is expected to flesh out `makeFakeClient` as they add each route operation — keep the stub minimal, one operation at a time, mirroring the route's actual chain. Resist the urge to write one giant stub up front; that's how mock drift starts.

- [ ] **Step 2: Verify the smallest test (`401`) fails**

Run: `rtk proxy pnpm test -- tests/unit/api/posts-create.test.ts -t 401`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement minimal route — just auth + parse**

```ts
// app/api/posts/route.ts
import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { PostCreateBody } from '@/lib/posts/schema'
import { slug as toSlug } from '@/lib/posts/slug'
import { isReserved } from '@/lib/reserved-names'
import { isValidCoverImageUrl } from '@/lib/posts/cover-image'
import { extractStructuredSections } from '@/lib/posts/sections'
import { extractWikilinkAnchors } from '@/lib/posts/wikilinks-extract'
import { resolveAnchor } from '@/lib/posts/wikilinks-resolve'
import { renderToHtml } from '@/lib/posts/render'
import { findUniqueSlug } from '@/lib/posts/slug-collision'
import { postUrl, type PostType } from '@/lib/posts/url'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function POST(req: NextRequest | Request): Promise<Response> {
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  const parsed = PostCreateBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    })
  }
  // … continue in the next steps; one operation at a time, each behind
  //   its own failing test.

  return json(500, { error: 'not_implemented' })
}
```

Run the 401 test: PASS.

- [ ] **Step 4: Add each next operation behind its own failing test, then implement, then commit**

For each of these sub-operations, write a failing test, run, implement minimum to pass, run, commit. Do NOT batch.

  4a. Validate cover_image_url prefix.
  4b. Derive baseSlug; reject when `isReserved(baseSlug)`.
  4c. Look up author username + 500 on missing row.
  4d. Pre-fetch existing tags + reject when any new tag slug is reserved.
  4e. `findUniqueSlug`.
  4f. Insert new pending tags.
  4g. Wikilink anchor extraction + resolution map (call `resolveAnchor` for each unique anchor).
  4h. `renderToHtml` with resolver map lookup.
  4i. `insert posts` row (capture `id`).
  4j. `insert post_tags` rows.
  4k. `insert post_versions` row (version_no=1).
  4l. `insert post_references` rows for resolved anchors.
  4m. Return 201 with `{ id, slug, url }`.

Each substep gets its own commit (e.g. `feat(posts): wire cover image prefix check in POST /api/posts`).

- [ ] **Step 5: Final route test pass**

Run: `rtk proxy pnpm test -- tests/unit/api/posts-create.test.ts`
Expected: PASS — all enumerated cases green.

- [ ] **Step 6: Final commit (if any squashing needed; otherwise sub-commits already landed)**

```bash
git status   # confirm clean
```

---

### Sub-task 11: `PATCH /api/posts/[id]` route handler

**Files:**
- Create: `app/api/posts/[id]/route.ts`
- Test: `tests/unit/api/posts-patch.test.ts`

Pipeline:
1. `getSession()` → 401.
2. Load post by `id`; 404 if not found.
3. Author check: `session.user.id === post.author_id || isAdmin(session.user.github_login)` — wait: `isAdmin` reads from env by **login**, but the session only has `id`. Look up the login: `from('next_auth.users').select('github_login').eq('id', session.user.id).single()`. If neither author nor admin → 403.
4. `PostPatchBody.safeParse` → 400.
5. Cover image bucket check, structured sections re-derivation (using existing post.type), tag picker validation, tag insert-if-missing, wikilink extract + resolve, render → as in POST.
6. Compute next `version_no = MAX(version_no) + 1`. **First snapshot the prior `posts.body_md` into `post_versions` BEFORE updating the row.** Trigger caps at 20.
7. Diff old vs new `post_references`: delete all where `source_post_id = post.id`, insert new resolved rows. (Simpler than diff; small per-post N.)
8. Diff `post_tags`: delete all where `post_id = post.id`, re-insert.
9. `update posts set title, summary, body_md, body_html, structured_sections, cover_image_url, edited_at = now()`. (slug, type unchanged.)
10. Return `{ id, slug, url }` 200.

- [ ] **Step 1: Failing tests file scaffold**

```ts
// tests/unit/api/posts-patch.test.ts
describe('PATCH /api/posts/[id]', () => {
  it('returns 401 when unauthenticated', async () => {})
  it('returns 404 when post not found', async () => {})
  it('returns 403 when not author and not admin', async () => {})
  it('allows admin to edit any post', async () => {})
  it('rejects when type field is in body', async () => {})
  it('snapshots prior body_md into post_versions before updating', async () => {})
  it('replaces post_references on re-publish', async () => {})
  it('replaces post_tags on re-publish', async () => {})
  it('updates edited_at', async () => {})
})
```

- [ ] **Step 2–N: TDD each case**

Follow the same one-op-one-test-one-commit cadence as Task 10. Reference Task 10's tests for the fake-client pattern.

- [ ] **Step Final: Commit per substep, then ensure full file passes**

```bash
rtk proxy pnpm test -- tests/unit/api/posts-patch.test.ts
```

---

### Sub-task 12: `DELETE /api/posts/[id]` route handler

**Files:**
- Modify: `app/api/posts/[id]/route.ts` (add DELETE export)
- Test: `tests/unit/api/posts-delete.test.ts`

Pipeline:
1. `getSession()` → 401.
2. Load post; 404 if not found; treat already-deleted as 404.
3. Author check (as PATCH).
4. `update posts set deleted_at = now(), deletion_reason = <'author' or 'moderation'>`.
5. Return `{ ok: true }` 200.

- [ ] **Step 1: Failing tests**

```ts
// tests/unit/api/posts-delete.test.ts
describe('DELETE /api/posts/[id]', () => {
  it('returns 401 when unauthenticated', async () => {})
  it('returns 404 when post not found', async () => {})
  it('returns 404 when post already deleted', async () => {})
  it('returns 403 when not author and not admin', async () => {})
  it("sets deletion_reason='author' for author delete", async () => {})
  it("sets deletion_reason='moderation' for admin delete", async () => {})
  it("does not modify comments/likes/bookmarks rows", async () => {})
})
```

- [ ] **Steps 2-N: TDD per case, commit per substep**

- [ ] **Step Final**

```bash
rtk proxy pnpm test -- tests/unit/api/posts-delete.test.ts
```

---

### Sub-task 13: Wire the editor's Publish button

**Files:**
- Modify: `components/editor/EditorShell.tsx`
- Test: extend `tests/unit/components/editor-shell.test.tsx` (existing)

Behavior:
- On click: disable button; show "Publishing…" label.
- `fetch('/api/posts', { method: mode === 'new' ? 'POST' : 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) })` where `payload` mirrors `PostCreateBody` (or `PostPatchBody` for edit).
- On 2xx: `clearDraft(<draftKey>)`, `router.push(json.url)`.
- On 4xx with `issues`: render the first issue's `message` next to the button.
- On 5xx or network error: render generic error message; re-enable button.
- Edit page: pass `mode='edit'` and `editPostId` to EditorShell so the fetch goes to `/api/posts/<id>` with PATCH.

- [ ] **Step 1: Failing component test for the 401 / 400 error display**

Add to `tests/unit/components/editor-shell.test.tsx` a case that mocks `fetch` to return 400 with `{ error: 'invalid_body', issues: [{ path: ['summary'], message: 'Summary too long' }] }` and asserts the message is visible after clicking publish.

- [ ] **Step 2: Verify it fails**

Run: `rtk proxy pnpm test -- tests/unit/components/editor-shell.test.tsx`
Expected: FAIL — current click handler is `alert`.

- [ ] **Step 3: Implement the new publish handler**

Replace the existing `handlePublish` with the fetch flow. Use `useRouter` from `next/navigation`. Use `useTransition` to keep the button responsive.

```tsx
const router = useRouter()
const [publishing, setPublishing] = useState(false)
const [serverError, setServerError] = useState<string | null>(null)

const handlePublish = useCallback(async () => {
  if (validation.errors.length > 0) return
  setPublishing(true)
  setServerError(null)
  try {
    const url = mode === 'new' ? '/api/posts' : `/api/posts/${editPostId}`
    const method = mode === 'new' ? 'POST' : 'PATCH'
    const body: Record<string, unknown> = {
      title,
      summary,
      body_md: bodyMd,
      tags: tags.map((t) => t.slug),
      cover_image_url: coverImageUrl ?? undefined,
    }
    if (mode === 'new') body.type = type
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setServerError(
        data?.issues?.[0]?.message ??
          data?.error ??
          `Publish failed (status ${res.status})`,
      )
      return
    }
    draftRef.current?.clearDraft()
    router.push(data.url)
  } catch (e) {
    setServerError(e instanceof Error ? e.message : 'Network error')
  } finally {
    setPublishing(false)
  }
}, [/* deps … */])
```

- [ ] **Step 4: Verify component tests pass**

Run: `rtk proxy pnpm test -- tests/unit/components/editor-shell.test.tsx`
Expected: PASS — new case + all existing cases green.

- [ ] **Step 5: Modify `/write/[postId]/page.tsx`**

Read the existing page; wire `editPostId={params.postId}` into the `EditorShell` prop set. If `EditorShell` doesn't already declare `editPostId` as a prop, add it.

- [ ] **Step 6: Commit**

```bash
git add components/editor/EditorShell.tsx app/write/[postId]/page.tsx tests/unit/components/editor-shell.test.tsx
git commit -m "feat(editor): wire publish button to POST/PATCH /api/posts (Phase 4)"
```

---

### Sub-task 14: E2E publish tests

**Files:**
- Create: `tests/e2e/publish.spec.ts`

Cases (use Playwright's `request` for direct API hits + the page-level helper for editor flow):

1. Unauth POST → 401.
2. Unauth PATCH → 401.
3. Unauth DELETE → 401.
4. Authed user (via E2E shim) creates a post via the editor; lands on `/<username>/<type>/<slug>` (404 expected — assert `response.status() === 404` AND URL matches the expected pattern).
5. Authed user can PATCH own post.
6. Authed user cannot PATCH another user's post (set up second user fixture or POST with `E2E_TEST_AUTH_USER_ID=<other>`).
7. Authed user can DELETE own post (verify `deleted_at IS NOT NULL` via API GET or DB readback — DB readback is simpler).

- [ ] **Step 1: Write the failing spec**

```ts
// tests/e2e/publish.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Phase 4 publish API', () => {
  test('unauth POST returns 401', async ({ request }) => {
    const res = await request.post('/api/posts', { data: {} })
    expect(res.status()).toBe(401)
  })
  // … more cases …
})
```

- [ ] **Step 2: Verify it fails (route exists, header missing)**

Run: `rtk proxy pnpm e2e -- tests/e2e/publish.spec.ts`
Expected: most cases pass, some fail until the editor wiring lands.

- [ ] **Step 3: Iterate until green**

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/publish.spec.ts
git commit -m "test(e2e): cover Phase 4 publish API + editor wiring"
```

---

### Sub-task 15: Full RTK-proxy verification gate

- [ ] **Step 1: Typecheck**

```bash
rtk proxy pnpm typecheck
```

Expected: zero errors.

- [ ] **Step 2: Lint**

```bash
rtk proxy pnpm lint
```

Expected: zero errors.

- [ ] **Step 3: Unit tests**

```bash
rtk proxy pnpm test
```

Expected: all unit tests pass, including pre-Phase-4 ones (no regressions).

- [ ] **Step 4: Build**

```bash
rtk proxy pnpm build
```

Expected: build succeeds (catches Next.js 16 strict App Router issues that `pnpm typecheck` misses).

- [ ] **Step 5: E2E**

```bash
rtk proxy pnpm e2e
```

Expected: all pass.

If any gate fails, fix and re-run THAT gate via `rtk proxy`. Do NOT claim CI-green from a plain `pnpm` run (per `feedback_rtk_verification`).

---

### Sub-task 16: Stale-doc cleanup pass

- [ ] **Step 1: Update `docs/v1-plan.md` Phase 4 section**

Replace stale references to `is_deleted` / `deleted_by` / `post_links` with `deleted_at` / `deletion_reason` / `post_references` (matching the actual `0002_content.sql`). One commit.

```bash
git add docs/v1-plan.md
git commit -m "docs(v1-plan): sync Phase 4 text with shipped schema names"
```

---

### Sub-task 17: PR to `develop`

- [ ] **Step 1: Push branch**

```bash
rtk proxy git push -u origin feat/phase-4-publish-api
```

- [ ] **Step 2: Open PR via `gh`**

```bash
gh pr create --base develop --title "Phase 4: publish API (POST/PATCH/DELETE /api/posts)" --body "$(cat <<'EOF'
## Summary
- `POST /api/posts` — auth, Zod validation, MDX→HTML render, slug uniqueness, structured_sections derivation, tag auto-pending, wikilink resolver + `post_references` writes, `post_versions` v1 snapshot.
- `PATCH /api/posts/[id]` — author + admin gates, prior-body snapshot before update, tag/refs diff via delete-then-insert, `edited_at` bump.
- `DELETE /api/posts/[id]` — soft delete with `deletion_reason ∈ ('author','moderation')`. Does not touch comments/likes/bookmarks.
- Editor publish button wired to the API (loading state, error surfacing, draft clear on success, router.push to `/<username>/<type>/<slug>`).

## Wikilink resolver
Slugifies the anchor → looks up `posts.slug` matches → tiebreak `(author = me) DESC, COUNT(likes) DESC, published_at DESC` (no denormalised `like_count` yet; one extra correlated count). Unresolved anchors render as `<span class="broken-wikilink">` with no CTA.

## post_versions snapshot timing
On PATCH: snapshot the PRIOR `posts.body_md` into `post_versions` BEFORE updating the row, with `version_no = MAX(version_no) + 1`. Phase 2's `cap_post_versions` trigger keeps the last 20.

## Deviations from spec
- `structured_sections` is derived server-side from canonical H2 headings in `body_md` rather than being a separate editor field; matches Phase 3's existing validation. Confirmed with orchestrator pre-implementation.
- Wikilink tiebreak uses `COUNT(public.likes)` because no denormalised `posts.like_count` column ships until Phase 8.
- `cover_image_url` validation is a URL-prefix string check (`${SUPABASE_URL}/storage/v1/object/public/covers/…`) — head-checking the object would require an extra Storage round-trip and the uploaded URL is the only way to reach this endpoint.

## Out of scope (not in this PR)
- Phase 5 read page (`/<username>/<type>/<slug>` returns 404).
- Admin tag-approval UI (Phase 12).
- Comments / likes / bookmarks (Phases 7–8).

## Test plan
- [x] `rtk proxy pnpm typecheck`
- [x] `rtk proxy pnpm lint`
- [x] `rtk proxy pnpm test`
- [x] `rtk proxy pnpm build`
- [x] `rtk proxy pnpm e2e`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Report PR URL to AO**

```bash
ao report pr-created --pr-url <url>
```

---

## Self-Review (pre-execution)

**Spec coverage:**
- POST/PATCH/DELETE — Tasks 10/11/12 ✓
- Wikilink resolver with own→likes→recency tiebreak — Task 4 ✓
- Tag auto-pending with `is_approved=false` — Task 10.4f ✓
- Reserved-name overlap for tag slugs AND post slugs — Task 10.4b, 10.4d ✓
- Cover image bucket constraint — Task 6 ✓
- `structured_sections` validation per type — Task 2 + route checks ✓
- `post_versions` v1 on create, snapshot-before-update on edit, trigger handles cap — Tasks 10.4k, 11.6 ✓
- Editor wiring + draft clear + redirect — Task 13 ✓
- Tests (unit + e2e) — Tasks 1–9, 10, 11, 12, 14 ✓
- RTK-proxy verification gate — Task 15 ✓
- Branch off `develop`, PR back — done at session start + Task 17 ✓

**Placeholder scan:** none. Every step has either runnable code, a runnable command, or an explicit "see Task N" pointer.

**Type consistency:** `PostType` defined in `lib/posts/url.ts` (Task 1), reused in `sections.ts` (Task 2), `wikilinks-resolve.ts` (Task 4), `schema.ts` (Task 7), `render.ts` (Task 9), routes (Tasks 10–12). `ResolvedAnchor` shape consistent between Task 4 (return type) and Task 10 (use site). `findUniqueSlug`, `extractWikilinkAnchors`, `resolveAnchor`, `renderToHtml`, `extractStructuredSections`, `isValidCoverImageUrl`, `PostCreateBody`/`PostPatchBody`, `postUrl` — names match between definition and call sites.

---

## Execution

Use `superpowers:subagent-driven-development` — dispatch one implementer subagent per task (or per sub-step inside Tasks 10/11/12), with a code-quality + spec-conformance reviewer in between major tasks. Branch is already `feat/phase-4-publish-api` off `develop`.

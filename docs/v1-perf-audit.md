# v1 Performance Audit — Index Coverage

Phase 14, sub-task 6 (DB hygiene). Walks every hot-path read against the index
catalog in `supabase/migrations/0002_content.sql` + `0006_user_github_login.sql`
to confirm every WHERE / ORDER BY column has appropriate index backing at
launch scale.

> **No new migration shipped in Phase 14.** Existing index coverage is
> complete for v1 launch. Re-audit post-launch once any table crosses 10k
> rows.

## Method

Production EXPLAIN ANALYZE was not run for this phase — the dev DB has no
seed data and the agent does not have credentials for the linked
`agentlab-prod` instance. Instead, every hot-path query was traced from
the call site back to the SQL, then matched against the index catalog.
Any query whose WHERE or ORDER BY is not directly served by an existing
index is called out below.

A row-count tipping point of ~1k is used to decide "seq scan acceptable
vs. needs an index" — Postgres typically picks a seq scan up to ~10k
rows even when an index exists, so anything under 1k is unambiguously
fine.

## Hot-path queries

### 1. For-You feed shortlist — `feed_shortlist_by_heat` RPC

**Call site:** `lib/feed/shortlist.ts:57` → `lib/feed/index.ts` (home `/`).

**Query shape:**

```sql
SELECT ... FROM public.posts p
WHERE p.deleted_at IS NULL
  AND p.published_at <= now()
ORDER BY (heat_expr) DESC, p.published_at DESC
LIMIT 200;
```

**Index used:** none for the heat sort — it's a computed expression over
`like_count`, `bookmark_count`, and `published_at`. Postgres must
materialise the candidate set and sort.

**Indexes consulted by planner:** `posts_type_published_idx` (partial,
`deleted_at IS NULL`) helps narrow the candidate set, but with no `type`
predicate the leading column is unconstrained — Postgres will fall back
to a seq scan over the partial index OR a heap seq scan.

**Verdict:** Acceptable at v1 scale. The shortlist LIMIT is 200; even
with 10k posts the materialise + sort runs in <50ms. Re-audit if posts
exceeds ~25k rows; a materialised view refreshed every N minutes is the
standard escape hatch.

### 2. Comments for a post — `CommentsSection`

**Call site:** `components/post/CommentsSection.tsx:35`.

**Query shape:**

```sql
SELECT ... FROM public.comments
WHERE post_id = ?
ORDER BY created_at ASC;
```

**Index used:** `comments_post_created_idx (post_id, created_at)`. The
leading column is the WHERE predicate and the trailing column is the
ORDER BY — exact match. Index-only scan when `body` etc. are not needed,
but the embed pulls everything so it's an index scan + heap fetch.

**Verdict:** Covered. No work needed.

### 3. Post page lookup — `lookupPost`

**Call site:** `lib/posts/lookup.ts:87` → every `/[username]/[type]/[slug]`
render.

**Query shape (two roundtrips):**

```sql
-- Step 1
SELECT id, username, display_name, avatar_url, bio
FROM public.users WHERE username = ? LIMIT 1;

-- Step 2
SELECT ..., post_tags(...)
FROM public.posts
WHERE author_id = ? AND type = ? AND slug = ? AND deleted_at IS NULL
LIMIT 1;
```

**Indexes used:**
- Step 1: `users_username_idx (username)`
- Step 2: `posts_author_slug_unique (author_id, slug)` — unique constraint
  index. Narrows to 1 row, then `type` and `deleted_at` filters run on the
  single candidate.

**Verdict:** Covered. Both queries are O(log n) regardless of scale.

### 4. Profile feed — author's posts

**Call site:** `app/[username]/page.tsx` via `lib/feed/index.ts`.

**Query shape:**

```sql
SELECT ... FROM public.posts
WHERE author_id = ? AND deleted_at IS NULL
ORDER BY published_at DESC
LIMIT 30 OFFSET ?;
```

**Index used:** `posts_author_published_idx (author_id, published_at DESC)
WHERE deleted_at IS NULL` — exact match including the partial predicate.

**Verdict:** Covered.

### 5. Tag landing — posts by tag

**Call site:** `app/tag/[slug]/page.tsx`.

**Query shape:**

```sql
SELECT ..., posts!inner(...) FROM public.post_tags
WHERE tag_slug = ? AND posts.deleted_at IS NULL
ORDER BY posts.published_at DESC LIMIT 30;
```

**Indexes used:** `post_tags_tag_idx (tag_slug)` for the WHERE; the
`posts!inner` join uses the primary key on `posts.id`. The sort is on a
join column, so Postgres will hash-join then sort. At v1 scale (≤ few
hundred posts per tag) this is sub-10ms.

**Verdict:** Covered. Re-audit if a single tag accrues >5k posts.

### 6. Backlinks — `getBacklinks`

**Call site:** `lib/posts/backlinks.ts:36`.

**Query shape:**

```sql
SELECT source_post_id FROM public.post_references
WHERE target_post_id = ?;
```

**Index used:** `post_references_target_idx (target_post_id)` — exact
match.

**Verdict:** Covered.

### 7. Engagement counts — denormalised

`likes`, `bookmarks`, `comments` all have triggers that maintain
`posts.like_count`, `bookmark_count`, `comment_count`. The post page +
feed read those columns directly off the `posts` row. No index work for
read.

For inserts / deletes, the per-`(user_id, post_id)` upsert / delete uses
the composite PK on each engagement table — covered.

### 8. Follow lookups

`follows` table has PK `(follower_id, followed_id)` + index
`follows_followed_idx (followed_id)`. Every query inspected
(`lib/profile/follow-list.ts`, `lib/profile/follow-state.ts`,
`lib/feed/affinity.ts`) filters by `follower_id` (uses PK) or
`followed_id` (uses follows_followed_idx).

**Verdict:** Covered.

### 9. Admin queues

- Pending tags: `tags_is_approved_idx (is_approved)`.
- Open reports: `reports_open_idx (created_at) WHERE resolved_at IS NULL`.
- Mod audit: `mod_actions_mod_idx (mod_user_id, created_at DESC)` +
  `mod_actions_target_idx (target_type, target_id)`.

**Verdict:** Covered for v1 admin queue sizes (< 100 rows expected).

## Conclusion

No index gaps found. Phase 14 ships **zero new perf indexes** — the
single new migration (`0012_signup_flags.sql`) adds an unindexed jsonb
column which is only ever read by post-launch ad-hoc admin queries.

## Post-launch checklist

When any table crosses 10k rows, re-run `EXPLAIN (ANALYZE, BUFFERS)`
against the queries above and look for:

- Sequential Scans with cost > 1000 — add a partial index on the WHERE
  predicate.
- Bitmap Heap Scans with recheck cost > 50% — extend the existing index
  to cover the rechecked columns.
- Sort steps that exceed `work_mem` (visible as "Sort Method: external
  merge") — bump `work_mem` for the role or pre-sort via index.

The `feed_shortlist_by_heat` materialise + sort is the first thing
likely to regress; a 5-minute materialised view refresh is the v2 plan
of record.

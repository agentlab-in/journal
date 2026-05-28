# v1 Plan — Open Product Questions

These decisions came up while brainstorming the v1 implementation plan. They are NOT pinned down by Discussion #2. They are split into:

- **BLOCKERS** — I cannot finalize the plan without an answer. There are 4.
- **STRONG DEFAULTS** — I have a recommendation that, if accepted, lets me proceed. There are 10. Please scan and either ack or override.
- **MINOR DEFAULTS** — I'm proceeding with these baked into the plan. Listed here for transparency; tell me if any are wrong. There are 14.

Total: 28 decisions surfaced.

---

## BLOCKERS — please answer before I write the plan

### B1. `@agentlab` curator handle conflicts with a real GitHub org

The locked spec says distilled posts go under a `@agentlab` curator account. I just checked: **`github.com/agentlab` already exists** as a real organization (AutoML / Linked Data, blog `agentlab.eu`, Portugal-based, 173 public repos, created 2012). Because our URL rule is `agentlab.in/<github-login> ↔ github.com/<github-login>`, publishing distilled work under "agentlab" would impersonate that org — the exact risk the spec calls out for `karpathy`.

How do you want to handle the curator identity?

- **Option A — Pick a different real GitHub handle** for the curator bot (e.g. `agentlab-curator`, `agentlab-distillery`, `agentlab-editorial`). Harshit registers the bot account on GitHub, holds the OAuth credentials, signs in as it to publish.
- **Option B — Introduce "publish-as" alongside the personal account.** Harshit signs in as himself; the editor has a dropdown to publish a post under a virtual "AgentLab Editorial" identity. Backed by an `account_aliases` table; the alias is NOT a real GitHub user, has no `/<handle>` profile page (or has a special non-`<username>` route like `/editorial`).
- **Option C — Treat distilled work as authored by Harshit personally** with a visible "Distilled from: …" attribution block; no curator identity at all.
- **Option D — Something else.**

I recommend **A** (cleanest fit with the "username = GitHub login, always" invariant). It does require Harshit to register the bot handle on GitHub before launch.

---

### B2. How do org accounts publish? (e.g. `@anthropic` as author)

Spec says org accounts are supported. GitHub OAuth logs in a *user*, not an *org*. To publish "as Anthropic," we need a way to tie the post's author to an org rather than the signed-in user.

- **Option A — Defer org publishing to v1.1.** Treat `agentlab.in/anthropic` as a profile page that exists (auto-created when first viewed, populated from GitHub org data), but only Anthropic members posting under their own handles fill the catalog. Org "ownership" of posts is post-v1.
- **Option B — GitHub Apps + org membership check.** Use a GitHub App (not just OAuth) so we can read org membership. If a user is a public member of org X, they can publish "as X." Requires a richer auth flow.
- **Option C — Manual admin grant.** Admin (you) flags users as "may publish as org X." UI dropdown in editor when applicable.

I recommend **A** for v1 — getting OAuth-only working in 2 weeks already crowds the schedule. Org profile pages can exist (read-only) without org-authored posts.

---

### B3. MDX component allowlist

Spec: "MDX with an allowlist of components we ship (Callouts, embeds, etc.)" — but no concrete list. The allowlist directly drives renderer architecture and what authors can express.

My proposed initial set (please add/remove):

| Component | Purpose |
|---|---|
| `<Callout type="info\|tip\|warning\|danger" />` | Highlighted notes |
| `<Embed url="..." />` | Tweets, YouTube, GitHub gists (server-side oEmbed) |
| `<Figure src="" caption="" alt="" />` | Captioned images |
| `<Aside />` | Sidebar/footnote-style notes |
| `<Detail summary="...">` | Collapsible disclosure |
| ` ```mermaid ` fenced block | Mermaid diagrams (not an MDX component, but a fenced-code interpreter) |

NOT including (verify): video embeds, custom React, iframes, raw HTML, code sandboxes, polls, audio.

OK to ship with this list? Anything you want to add/remove for launch?

---

### B4. `[[wikilinks]]` resolution semantics

This affects link-storage schema and backlink correctness. The spec says "auto-link `[[Pattern Name]]`" but not how to resolve ambiguity.

Sub-decisions:

1. **Resolution scope.** When I write `[[Trust Gate]]`, do we (a) search across ALL posts globally, (b) only within my own posts, (c) only within posts tagged the same, or (d) only within posts of the same type (pattern)?
2. **Ambiguity.** If two posts match `[[Trust Gate]]` (e.g. one by me, one by another author), what wins? Options: (a) highest like count, (b) most recent, (c) my own posts > others, (d) show as ambiguous "broken-link" until disambiguated with `[[Trust Gate|author/post/slug]]` syntax.
3. **Unresolved.** What does `[[Nonexistent Thing]]` render as? Options: (a) plain text, (b) a styled "broken wikilink" with hover-state, (c) a "create this post?" CTA (probably v2).
4. **Resolution timing.** Resolve and store the link target at save-time (fast reads, stale on rename) or at render-time (slow, always current)? Slugs are immutable per spec, so save-time storage is durable; only edge case is "linked post was later deleted."

My recommendations: (1) global; (2) own > others, then highest like count, then most recent; (3) styled broken-link with no CTA in v1; (4) resolve at save-time, store in `post_links` table for backlinks, re-resolve when a post is deleted/restored.

OK to go with these?

---

## STRONG DEFAULTS — recommend, but please ack or override

### S1. Reserved usernames (route collisions)

`agentlab.in/<username>` must NOT collide with platform routes. Proposed reserved list (case-insensitive, blocked at signup AND if a user with this name attempts to sign in, we show "AgentLab needs to reserve your GitHub handle — please contact support" — vanishingly rare given they'd need to match an existing GitHub login):

```
api, admin, auth, _next, static, public, assets,
about, contact, help, faq, support, privacy, terms, policy, legal, dmca,
login, logout, signin, signout, signup, register, sso, oauth,
new, write, edit, publish, draft, drafts, editor,
settings, profile, account, me, you, dashboard, billing,
home, feed, explore, discover, search, trending, popular, top, latest, for-you,
post, posts, dive, dives, playbook, playbooks, pattern, patterns,
tag, tags, topic, topics, category, categories,
user, users, author, authors, org, orgs, team, teams,
bookmark, bookmarks, like, likes, follow, followers, following,
comment, comments, reply, replies, notification, notifications, inbox,
report, reports, mod, admin, moderation, flag,
rss, atom, feed, feeds, sitemap, robots, manifest, .well-known, favicon,
agentlab, agent, lab, root, system, anonymous, deleted,
404, 500, error, offline
```

(Plus we'll add the curator handle from B1 to this list automatically.)

OK?

---

### S2. Sign-up gate enforcement step

GitHub account ≥30 days old AND ≥1 public repo. I'll enforce in NextAuth `signIn` callback using the GitHub `/user` API (already in OAuth scope), checked **every sign-in attempt** (not just the first) so users who get rejected at day-29 can come back at day-30 without manual intervention.

Rejection page: friendly message with the exact reason ("Your GitHub account needs to be 30 days old. You're at 27 days — come back on May 31, 2026.") and a "back to homepage" CTA. No appeals form in v1.

OK?

---

### S3. Heat-score formula for "For You" + mixed feed

```
score = (likes + 2*bookmarks + 0.5*comments + tag_affinity_boost)
        / (hours_since_published + 2)^1.5

tag_affinity_boost = 5 if any tag overlaps with logged-in user's authored-post tags, else 0
                     (0 for signed-out viewers — "For You" hides for them; show generic mixed feed)
```

Pure HN-style decay with a tag-affinity nudge. Hidden constants we can tune later without a schema change. Score computed at read-time over a candidate set (top N by recency + top N by likes, deduped); not stored.

OK?

---

### S4. Tag approval workflow

When an author types a new tag in the editor (autocomplete misses):

- Tag is created in DB with `is_approved = false`, attached to the post.
- Post publishes immediately with all its tags visible *on the post page*.
- Unapproved tags do NOT appear on `/tag/<slug>` landing pages, search results, related-posts logic, or the curated tag picker for other authors.
- Admin sees pending tags at `/admin/tags`; can approve, reject (which detaches from post), or merge into an existing tag.

OK?

---

### S5. Staging deployment topology

- `main` branch → Vercel Production env → `agentlab.in`
- `staging` branch → Vercel "Preview" pinned alias → `staging.agentlab.in`
- Every PR → Vercel preview URL (auto)
- Workflow: feature branch → PR (preview URL) → squash-merge to `staging` (soak on `staging.agentlab.in`) → fast-forward `main`
- **Two Supabase projects:** `agentlab-prod` and `agentlab-staging` (separate DBs, separate Storage buckets). Schema migrated to staging first via `supabase db push`, manually promoted to prod after soak. Env vars per Vercel env.
- Seed-data script that populates staging with a representative slice (no real user PII).

OK on the topology and the two-Supabase-project decision?

---

### S6. Comments — author edit window, delete, depth

- Authors can edit their own comments for **24 hours** after posting; after that, only delete is available. (Prevents stealth content changes mid-thread.)
- Soft-delete only — body replaced with "[deleted]," replies remain visible.
- Max thread depth: **5** (UI collapses deeper replies into "continue this thread" links).
- Markdown allowed in comments, but no MDX components, no images, no embeds.
- Comments cannot be flagged as posts — separate report-comment flow.

OK?

---

### S7. Bookmarks visibility

- Bookmarks are **private by default**, viewable only by the owner at `/bookmarks` (note: this is a reserved path, not a username route).
- No "public bookmark list" UX in v1. (Reserved for v1.1 — "this user bookmarked X" social discovery.)
- Bookmark counts on posts are public (and feed into heat score).

OK?

---

### S8. Notifications

In-app inbox only at `/notifications`. Notify on:
- New comment on your post
- Reply to your comment
- New follower
- Your tag suggestion approved/rejected
- (Admin) New report filed
- (Admin) New tag pending

No email notifications in v1. No web push. Inbox shows unread count badge on the nav.

OK?

---

### S9. Admin tooling

A `/admin` route gated by a hardcoded admin allowlist (env var `ADMIN_GITHUB_LOGINS=harshitsinghbhandari`). Pages:

- `/admin` — overview (counts: pending tags, open reports, recent signups)
- `/admin/tags` — approve/reject/merge tags
- `/admin/reports` — work the report queue
- `/admin/users` — search, view, block/unblock
- `/admin/posts` — search, soft-delete

Ad-hoc DB work still goes through Supabase dashboard. OK?

---

### S10. Post deletion semantics

- **Author deletes:** soft-delete (`is_deleted = true`). Post page returns 410 Gone with "this post was deleted by the author." Comments, likes, bookmarks remain in DB but the post is removed from feeds, profile, tag pages, search, and backlinks. Counts on the author's profile reflect non-deleted posts only.
- **Admin deletes** (content policy violation): same soft-delete, but the page shows "removed for policy violation." Author can no longer edit/restore.
- **Author deletes self account:** soft-delete user, attribute posts to a synthetic "[deleted]" account, remove avatar/bio. Comments by user replaced with "[deleted]."

OK?

---

## MINOR DEFAULTS — proceeding with these unless you object

(One-liners. These shape the plan but aren't worth a meeting.)

- **M1. RLS strategy.** RLS *enabled* on public-read tables (posts, comments, users, tags) with public-read policies; all writes go through Next.js API routes using the Supabase service role. Defense-in-depth without dual-writing all logic.
- **M2. NextAuth session storage.** DB sessions via the Supabase adapter (not JWTs) — so we can invalidate sessions when a user is blocked.
- **M3. Markdown rendering timing.** Server-render to HTML at save/publish; store `body_md` AND `body_html`. Re-render on edit. Fast reads, no client compute, no XSS surface from per-request rendering.
- **M4. HTML sanitization.** `rehype-sanitize` with a schema matching the MDX allowlist. Run after MDX compile, before storing `body_html`.
- **M5. Slug generation & collisions.** kebab-case from title, ASCII-folded, stop-word stripped. Per-author uniqueness — second post with same title gets `-2`. Slug is immutable after first publish; title changes don't change slug.
- **M6. Username case.** GitHub logins are case-insensitive; we store canonical lowercase. URL middleware redirects `/Harshit...` → `/harshit...` (301).
- **M7. Edit history.** Full body snapshot per edit in `post_versions`, capped at last 20 versions per post; older versions GC'd. Public surface: just an "edited 2 days ago" timestamp linking to nothing (no version browser in v1).
- **M8. View counting.** Atomic increment on the `posts.view_count` column, throttled to 1 per (post, viewer-fingerprint) per 24h. Fingerprint = signed-in user ID or hashed IP+UA for anonymous. View count visible only to author.
- **M9. Cover image processing.** Server-side resize to max 1600px wide (preserve aspect), strip EXIF, convert to WebP, store in Supabase Storage `covers/` bucket. URL embeds passed through as-is.
- **M10. Image upload validation.** 2MB hard cap (spec), JPEG/PNG/WebP/GIF only, MIME sniffed not trusted from header, dimensions capped at 6000×6000 to prevent decompression bombs.
- **M11. GitHub repos cache.** `github_repos_cache (user_id, fetched_at, repos jsonb)` — refresh on profile-page view if stale (>24h) AND on sign-in. Top 6 repos by stars surfaced on profile.
- **M12. localStorage draft format.** `agentlab.draft.new` for un-published drafts; `agentlab.draft.edit.<postId>` for edits. JSON `{ title, body, type, tags, summary, savedAt, schemaVersion }`. Auto-save every 30s. On editor open, if a draft exists, prompt "restore unsaved changes? (y/n)." For edits, if server `updated_at > savedAt`, warn "this post was edited elsewhere — discard your local draft?"
- **M13. RSS feeds.** Three flavors: site-wide (`/rss.xml`), per-author (`/<username>/rss.xml`), per-tag (`/tag/<slug>/rss.xml`). Latest 20 items each. Cached via Next.js ISR (revalidate 5 min).
- **M14. Sitemap.** `/sitemap.xml` index pointing to `sitemap-posts.xml`, `sitemap-users.xml`, `sitemap-tags.xml`. Generated via ISR (revalidate 1 hour).
- **M15. Pinned posts.** Max 6 per profile, author-ordered. (Counted in here because we surface it on profile.)

---

## How to respond

Easiest format:

```
B1: A (we'll register agentlab-editorial as the bot)
B2: A (defer org publishing)
B3: ack + add <X>, remove <Y>
B4: (1) global, (2) own>others, (3) styled broken-link, (4) save-time
S1..S10: ack (or "override Sn: ...")
M*: ack
```

Once I have these, I write `docs/v1-plan.md` and commit.

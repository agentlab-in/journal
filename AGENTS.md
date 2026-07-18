# agentlab.in journal

A gated, invite-only publishing platform for AI agent infrastructure knowledge: the structured reference layer for agent architecture, in the spirit of what Martin Fowler's catalog did for enterprise software patterns. Reads are public; writing requires manual approval. Live at https://journal.agentlab.in (repo: `agentlab-in/journal`).

**This platform is not for growth.** Its sole purpose is demonstrating capability. Do not optimize for signups, virality, SEO reach, or retention; judge every change by whether it showcases quality, not by whether it attracts or keeps users.

## Product shape

- Three content types: **Patterns** (reusable architecture solutions), **Playbooks** (operational AGENTS.md-style docs, hard 4-section structure), **Deep Dives** (long-form, requires TL;DR and The Question sections). Type is permanent after publish.
- URL structure: `/<github-username>/<type>/<slug>` with type in {`post`, `dive`, `playbook`}. Username = GitHub login, never changeable.
- Home page is a plain reverse-chronological Latest feed.
- **The engagement layer (likes, comments, bookmarks, follows, view counts, trending/For-You) was deliberately removed** in the 2026-07 pivot to a gated showcase (issue #85, migration 0026). Do not propose or reintroduce social/engagement features.

## Stack

- Next.js 16 (App Router) + React 19, TypeScript, Tailwind 4.
- Auth: NextAuth with GitHub OAuth only (no email fallback, ever). Database sessions via Supabase adapter.
- Data: Supabase Postgres (ap-south-1) + Supabase Storage for images. Migrations in `supabase/`.
- Editor: split-pane markdown (CodeMirror), MDX with a component allowlist, Prism highlighting, Mermaid supported, drafts are localStorage-only.
- Rate limiting: Upstash Redis (`lib/rate-limit.ts`), in-memory fallback in dev/CI only.
- Admin identity: `ADMIN_GITHUB_LOGINS` env var, not a DB column.

## Development

- `pnpm dev` (port 3010), `pnpm lint`, `pnpm typecheck`, `pnpm test` (Vitest), `pnpm e2e` (Playwright).
- Deploys: pushes to `main` auto-deploy to the dedicated Vercel `journal` project serving journal.agentlab.in. The `agentlab.in`/`www` domains are a separate Vercel project; never mix the two.
- Perf posture: functions run in iad1, users are largely in India, so every sequential DB round-trip costs ~150-200ms. Prefer fewer round-trips per render over query micro-optimization. Public routes stay under 200KB gz first-load JS.

## Conventions

- Design: mono typography everywhere, near-black/off-white theme (zinc-950/zinc-50), softened contrast, dark and light modes.
- Content license CC BY 4.0. Closed source posture: no external contributions.
- Never use em dashes in any prose, UI copy, or commit messages; use periods, commas, colons, or parentheses instead.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes: APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

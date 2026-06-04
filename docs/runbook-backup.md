# Backup & Restore Runbook — agentlab.in v1

## Tier

Supabase **Hobby** tier (free). No automatic point-in-time recovery, no
auto-backups. Manual backups are the entirety of the v1 plan.

## Backup procedure (weekly)

Run from a machine with the Supabase CLI installed + the project linked.

```bash
# One-time setup (per machine)
brew install supabase/tap/supabase  # or equivalent
supabase login
supabase link --project-ref <PROJECT-REF>

# Weekly backup
mkdir -p ~/agentlab-backups
supabase db dump --linked --schema public,next_auth \
  > ~/agentlab-backups/$(date +%Y-%m-%d).sql

# Optional: gzip + upload to a different cloud (S3 / Drive / etc.)
gzip ~/agentlab-backups/$(date +%Y-%m-%d).sql
```

Schedule: **Sunday 03:00 local** via launchd / cron. The bash one-liner is
short enough to inline as a cron entry.

Retain the last 8 weeks of backups. Older ones can be deleted.

## What's in the dump

- `public.*` — users, posts, post_versions, post_tags, post_references,
  comments, likes, bookmarks, follows, pinned_posts, reports, mod_actions,
  tags.
- `next_auth.*` — NextAuth session + account tables.

NOT in the dump:

- `auth.*` (Supabase-managed; reset on restore via OAuth re-login).
- `storage.*` schemas (covered by the storage bucket policy + Supabase's
  own object replication — see "Storage" section below).

## Storage buckets

The `covers` and `avatars` buckets are NOT in the SQL dump. Supabase
Storage objects are durable (S3-backed) but not separately backed up
by this runbook. v1 accepts this risk — re-uploading is the recovery
path. Document a cross-region object copy if/when usage exceeds the
free-tier storage cap.

## Restore drill — DOCUMENTED, NOT EXERCISED IN v1

Restore against a fresh Supabase project (not the prod project — destroys
data). Steps:

1. Provision new Supabase project, save its connection string.
2. `psql <CONNECTION_STRING> < ~/agentlab-backups/<date>.sql`
3. Run `supabase migration up` against the new project to bring the
   schema to current head (only if the dump predates a migration).
4. Update Vercel env vars to point at the new project.
5. Users will need to re-authenticate (next_auth session table comes back
   from the dump, but OAuth handshake state does not).

**Tested:** No. Restore drill is out of scope for v1; documented for
post-launch ops.

## Disaster recovery RTO/RPO

- **RTO** (recovery time objective): ~2 hours (re-provision Supabase +
  restore + env-var swap + DNS propagation).
- **RPO** (recovery point objective): ≤ 1 week (the gap between
  manual backups). For incidents in the last 7 days, the lost-data
  window is bounded by the most recent successful backup.

Upgrade to Supabase Pro for daily auto-backups + 7-day PITR if traffic
or content volume justifies the cost.

## Vercel Production env var checklist (pre-launch)

Set these in the Vercel project (Production scope) before merging develop → main:

- `NEXTAUTH_SECRET` — `openssl rand -base64 32`
- `NEXTAUTH_URL` — `https://agentlab.in`
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — from the agentlab.in GitHub OAuth app
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (server-only; never `NEXT_PUBLIC`)
- `ADMIN_GITHUB_LOGINS` — comma-separated, e.g. `harshitsinghbhandari`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — for rate limiting (optional; falls back to in-memory single-region if unset, which is NOT recommended for prod)

Preview env scope should mirror Production except Supabase points at a
dev branch DB if available.

## Known operational gotchas

### Account deletion blocked by `orgs.created_by_user_id`

`public.orgs.created_by_user_id` is `ON DELETE RESTRICT` (see
`supabase/migrations/0013_orgs.sql`). When Phase 11.5 sync materializes a
GitHub org for the first time it stamps that column with the signing-in
user's id. If that user later deletes their account, Postgres rejects the
delete with a FK violation pointing at `orgs`.

Resolution (manual, support-side):

1. Find any other active member:
   `SELECT user_id FROM public.org_members WHERE org_id = '<org-id>' LIMIT 1`.
2. Re-point: `UPDATE public.orgs SET created_by_user_id = '<other-user-id>' WHERE id = '<org-id>'`. Retry the delete.
3. If no other member exists, soft-delete the org first (`UPDATE public.orgs SET deleted_at = now() WHERE id = '<org-id>'`) so its public surfaces drop; then re-point `created_by_user_id` to an admin user id so the FK is satisfied, and retry the delete. A future sign-in by a GitHub member of that org will NOT resurrect the row (soft-delete is sticky to admin moderation); if a clean restart is desired, also `UPDATE public.orgs SET github_org_id = NULL` so the next sync inserts a fresh row instead.

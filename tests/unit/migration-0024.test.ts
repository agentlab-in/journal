import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let migration: string

beforeAll(() => {
  migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/0024_approved_users.sql'),
    'utf8',
  )
})

describe('0024_approved_users.sql shape', () => {
  it('creates public.approved_users keyed on github_login with a lowercase CHECK', () => {
    expect(migration).toMatch(/CREATE TABLE (IF NOT EXISTS )?public\.approved_users/)
    expect(migration).toMatch(
      /github_login\s+text PRIMARY KEY CHECK \(github_login = lower\(github_login\)\)/,
    )
  })

  it('enables RLS', () => {
    expect(migration).toMatch(/ALTER TABLE public\.approved_users ENABLE ROW LEVEL SECURITY/)
  })

  it('creates a service_role FOR ALL policy', () => {
    expect(migration).toMatch(
      /CREATE POLICY[\s\S]+ON public\.approved_users FOR ALL TO service_role/,
    )
  })

  it('revokes anon/authenticated access (no default-privilege leak)', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.approved_users FROM anon, authenticated/,
    )
  })

  it('seeds the owner via INSERT ... VALUES, not a grandfather backfill', () => {
    const seedMatch = migration.match(
      /INSERT INTO public\.approved_users[\s\S]+?ON CONFLICT \(github_login\) DO NOTHING;/,
    )
    expect(seedMatch).not.toBeNull()
    const seed = seedMatch![0]
    expect(seed).toMatch(/VALUES \('harshitsinghbhandari', now\(\), now\(\), 'system:owner-seed'\)/)
    // No grandfather backfill: the seed must not derive rows from an
    // existing table (e.g. `INSERT ... SELECT ... FROM public.users`).
    expect(seed).not.toMatch(/SELECT/)
  })

  it('require_approved_user is SECURITY DEFINER with a locked search_path', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.require_approved_user\(p_user_id uuid\)/,
    )
    expect(migration).toMatch(/require_approved_user[\s\S]+SECURITY DEFINER/)
    expect(migration).toMatch(/require_approved_user[\s\S]+SET search_path = public, pg_temp/)
  })

  it('enforce_author_approved is SECURITY DEFINER with a locked search_path', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.enforce_author_approved\(\)/)
    expect(migration).toMatch(/enforce_author_approved[\s\S]+SECURITY DEFINER/)
    expect(migration).toMatch(/enforce_author_approved[\s\S]+SET search_path = public, pg_temp/)
  })

  it('carries the C6 TG_ARGV injection-safety comment', () => {
    expect(migration).toMatch(/owner_col is supplied only by TG_ARGV/)
    expect(migration).toMatch(/FIXED in the CREATE TRIGGER DDL/)
    expect(migration).toMatch(/not an injection surface/)
  })

  it('carries the C2 no-backfill / never-copy-from-consents comment', () => {
    expect(migration).toMatch(/NEVER backfill this/)
    expect(migration).toMatch(/from public\.consents \(0022\)/)
    expect(migration).toMatch(/reintroduce a synthetic timestamp/)
  })

  it.each([
    ['posts_require_approved', 'posts', 'author_id'],
    ['comments_require_approved', 'comments', 'author_id'],
    ['likes_require_approved', 'likes', 'user_id'],
    ['bookmarks_require_approved', 'bookmarks', 'user_id'],
    ['follows_require_approved', 'follows', 'follower_id'],
    ['reports_require_approved', 'reports', 'reporter_id'],
    ['pinned_posts_require_approved', 'pinned_posts', 'user_id'],
  ])('creates BEFORE INSERT trigger %s on %s(%s)', (triggerName, table, ownerCol) => {
    const re = new RegExp(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON public\\.${table}[\\s\\S]+?EXECUTE FUNCTION public\\.enforce_author_approved\\('${ownerCol}'\\)`,
    )
    expect(migration).toMatch(re)
  })

  it('resolve_session_gate returns a table of banned_at + is_approved', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.resolve_session_gate\(p_user_id uuid\)/,
    )
    expect(migration).toMatch(
      /RETURNS TABLE \(banned_at timestamptz, is_approved boolean\)/,
    )
  })

  it('resolve_session_gate is server-only (revoked from PUBLIC, granted to service_role)', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.resolve_session_gate\(uuid\) FROM PUBLIC/,
    )
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.resolve_session_gate\(uuid\) TO service_role/,
    )
  })
})

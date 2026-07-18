import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let migration: string

beforeAll(() => {
  migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/0026_drop_engagement.sql'),
    'utf8',
  )
})

describe('0026_drop_engagement.sql shape', () => {
  // -------------------------------------------------------------------------
  // Guard-rail deletes (must precede the CHECK narrowing below)
  // -------------------------------------------------------------------------
  it('deletes reports rows outside post/user before narrowing the CHECK', () => {
    const deleteIdx = migration.indexOf("DELETE FROM public.reports WHERE target_type NOT IN ('post', 'user')")
    const checkIdx = migration.indexOf('ADD CONSTRAINT reports_target_type_check')
    expect(deleteIdx).toBeGreaterThan(-1)
    expect(checkIdx).toBeGreaterThan(-1)
    expect(deleteIdx).toBeLessThan(checkIdx)
  })

  it('uses NOT IN (not a plain = comment check) for the reports guard-rail delete', () => {
    // The old reports CHECK (0017) also allowed 'org', which the narrowed
    // CHECK here drops too, so a plain = 'comment' delete would leave a
    // stray org-target row behind and fail ADD CONSTRAINT.
    expect(migration).not.toMatch(/DELETE FROM public\.reports WHERE target_type = 'comment';/)
    expect(migration).toMatch(
      /DELETE FROM public\.reports WHERE target_type NOT IN \('post', 'user'\);/,
    )
  })

  it('deletes comment-target mod_actions before narrowing the CHECK', () => {
    const deleteIdx = migration.indexOf("DELETE FROM public.mod_actions WHERE target_type = 'comment'")
    const checkIdx = migration.indexOf('ADD CONSTRAINT mod_actions_target_type_check')
    expect(deleteIdx).toBeGreaterThan(-1)
    expect(checkIdx).toBeGreaterThan(-1)
    expect(deleteIdx).toBeLessThan(checkIdx)
  })

  // -------------------------------------------------------------------------
  // Tables
  // -------------------------------------------------------------------------
  it.each(['likes', 'comments', 'bookmarks', 'follows'])(
    'drops public.%s with CASCADE',
    (table) => {
      expect(migration).toMatch(
        new RegExp(`DROP TABLE IF EXISTS public\\.${table} CASCADE;`),
      )
    },
  )

  // -------------------------------------------------------------------------
  // Columns
  // -------------------------------------------------------------------------
  it.each(['view_count', 'like_count', 'bookmark_count', 'comment_count'])(
    'drops posts.%s',
    (col) => {
      expect(migration).toMatch(
        new RegExp(`ALTER TABLE public\\.posts DROP COLUMN IF EXISTS ${col};`),
      )
    },
  )

  it.each(['follower_count', 'following_count'])('drops users.%s', (col) => {
    expect(migration).toMatch(
      new RegExp(`ALTER TABLE public\\.users DROP COLUMN IF EXISTS ${col};`),
    )
  })

  it('drops mod_actions.target_comment_id', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.mod_actions DROP COLUMN IF EXISTS target_comment_id;/,
    )
  })

  it('notes that dropping target_comment_id also retires its CHECK and partial index', () => {
    const dropIdx = migration.indexOf('ALTER TABLE public.mod_actions DROP COLUMN IF EXISTS target_comment_id;')
    expect(dropIdx).toBeGreaterThan(-1)
    const preceding = migration.slice(Math.max(0, dropIdx - 500), dropIdx)
    expect(preceding).toMatch(/mod_actions_target_single_typed/)
    expect(preceding).toMatch(/mod_actions_target_comment_idx/)
  })

  // -------------------------------------------------------------------------
  // public.users_public view (must be dropped before, and recreated after,
  // the users.follower_count/following_count column drops)
  // -------------------------------------------------------------------------
  it('drops users_public before dropping the users count columns', () => {
    const dropViewIdx = migration.indexOf('DROP VIEW IF EXISTS public.users_public;')
    const dropFollowerIdx = migration.indexOf('ALTER TABLE public.users DROP COLUMN IF EXISTS follower_count;')
    expect(dropViewIdx).toBeGreaterThan(-1)
    expect(dropFollowerIdx).toBeGreaterThan(-1)
    expect(dropViewIdx).toBeLessThan(dropFollowerIdx)
  })

  it('recreates users_public without follower_count/following_count', () => {
    const viewMatch = migration.match(
      /CREATE VIEW public\.users_public AS\s*SELECT([\s\S]*?)FROM public\.users;/,
    )
    expect(viewMatch).not.toBeNull()
    const columns = viewMatch![1]
    expect(columns).not.toMatch(/follower_count/)
    expect(columns).not.toMatch(/following_count/)
    for (const col of ['id', 'username', 'display_name', 'bio', 'avatar_url', 'github_login', 'created_at']) {
      expect(columns).toMatch(new RegExp(`\\b${col}\\b`))
    }
  })

  it('recreates users_public after the users count column drops', () => {
    const dropFollowingIdx = migration.indexOf('ALTER TABLE public.users DROP COLUMN IF EXISTS following_count;')
    const createViewIdx = migration.indexOf('CREATE VIEW public.users_public AS')
    expect(dropFollowingIdx).toBeGreaterThan(-1)
    expect(createViewIdx).toBeGreaterThan(-1)
    expect(dropFollowingIdx).toBeLessThan(createViewIdx)
  })

  it('re-issues 0014\'s users_public grants exactly (REVOKE ALL then GRANT SELECT)', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON public\.users_public FROM anon, authenticated;\s*GRANT SELECT ON public\.users_public TO anon, authenticated;/,
    )
  })

  // -------------------------------------------------------------------------
  // Functions
  // -------------------------------------------------------------------------
  it.each([
    'increment_post_view_count(uuid)',
    'comment_depth_for_parent(uuid)',
    'handle_comment_count_change()',
    'feed_shortlist_by_heat(integer)',
    'handle_like_count_change()',
    'handle_bookmark_count_change()',
    'handle_follow_count_change()',
  ])('drops function %s', (signature) => {
    const escaped = signature.replace(/[()]/g, (c) => `\\${c}`)
    expect(migration).toMatch(
      new RegExp(`DROP FUNCTION IF EXISTS public\\.${escaped};`),
    )
  })

  // -------------------------------------------------------------------------
  // CHECK narrowing
  // -------------------------------------------------------------------------
  it('narrows reports.target_type to post/user only', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;\s*ALTER TABLE public\.reports ADD CONSTRAINT reports_target_type_check\s*CHECK \(target_type IN \('post', 'user'\)\);/,
    )
  })

  it('narrows mod_actions.target_type by dropping only comment', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.mod_actions DROP CONSTRAINT IF EXISTS mod_actions_target_type_check;\s*ALTER TABLE public\.mod_actions ADD CONSTRAINT mod_actions_target_type_check\s*CHECK \(target_type IN \('post', 'user', 'tag', 'report', 'org'\)\);/,
    )
    // 'comment' must be gone from the narrowed set.
    const constraintMatch = migration.match(
      /ADD CONSTRAINT mod_actions_target_type_check\s*CHECK \(target_type IN \(([^)]+)\)\);/,
    )
    expect(constraintMatch).not.toBeNull()
    expect(constraintMatch![1]).not.toContain("'comment'")
    // org survives (still written by app/api/admin/orgs/ban and unban).
    expect(constraintMatch![1]).toContain("'org'")
  })

  // -------------------------------------------------------------------------
  // search_posts recreation
  // -------------------------------------------------------------------------
  it('drops the old search_posts signature before recreating it', () => {
    expect(migration).toMatch(
      /DROP FUNCTION IF EXISTS public\.search_posts\(text, integer, text, text\[\]\);/,
    )
  })

  it('recreates search_posts without like_count/bookmark_count/comment_count', () => {
    const fnMatch = migration.match(
      /CREATE FUNCTION public\.search_posts\([\s\S]*?\$\$;/,
    )
    expect(fnMatch).not.toBeNull()
    const fnBody = fnMatch![0]
    expect(fnBody).not.toMatch(/like_count/)
    expect(fnBody).not.toMatch(/bookmark_count/)
    expect(fnBody).not.toMatch(/comment_count/)
  })

  it('keeps the id/author_id/type/slug/title/summary/snippet/published_at/rank return shape', () => {
    const returnsMatch = migration.match(
      /CREATE FUNCTION public\.search_posts\([\s\S]*?RETURNS TABLE \(([\s\S]*?)\)/,
    )
    expect(returnsMatch).not.toBeNull()
    const columns = returnsMatch![1]
    for (const col of [
      'id',
      'author_id',
      'type',
      'slug',
      'title',
      'summary',
      'snippet',
      'published_at',
      'rank',
    ]) {
      expect(columns).toMatch(new RegExp(`\\b${col}\\b`))
    }
  })

  it('is SECURITY DEFINER with locked search_path', () => {
    expect(migration).toMatch(/CREATE FUNCTION public\.search_posts[\s\S]*SECURITY DEFINER/)
    expect(migration).toMatch(/CREATE FUNCTION public\.search_posts[\s\S]*SET search_path = public, pg_temp/)
  })

  it('grants EXECUTE on the recreated search_posts to anon, authenticated, service_role', () => {
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.search_posts\(text, integer, text, text\[\]\)\s*TO anon, authenticated, service_role;/,
    )
  })

  // -------------------------------------------------------------------------
  // Untouched objects: no DDL statement (ALTER/DROP/CREATE) may target
  // these; the header comment is allowed to reference them by name for
  // documentation, so we scan statements rather than the raw file text.
  // -------------------------------------------------------------------------
  it('issues no DDL against the surviving approval-gate and index objects', () => {
    const ddlLines = migration
      .split('\n')
      .filter((line) => /^(ALTER|DROP|CREATE)\b/i.test(line.trim()))
    const ddlText = ddlLines.join('\n')
    for (const name of [
      'posts_published_idx',
      'posts_require_approved',
      'reports_require_approved',
      'pinned_posts_require_approved',
      'resolve_session_gate',
      'require_approved_user',
      'enforce_author_approved',
    ]) {
      expect(ddlText, `DDL should not reference ${name}`).not.toContain(name)
    }
  })
})

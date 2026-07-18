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
  it('deletes comment-target reports before narrowing the CHECK', () => {
    const deleteIdx = migration.indexOf("DELETE FROM public.reports WHERE target_type = 'comment'")
    const checkIdx = migration.indexOf('ADD CONSTRAINT reports_target_type_check')
    expect(deleteIdx).toBeGreaterThan(-1)
    expect(checkIdx).toBeGreaterThan(-1)
    expect(deleteIdx).toBeLessThan(checkIdx)
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

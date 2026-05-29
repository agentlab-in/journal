import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let migration: string

beforeAll(() => {
  migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/0007_comments_count_and_depth.sql'),
    'utf8',
  )
})

describe('0007_comments_count_and_depth.sql shape', () => {
  it('adds posts.comment_count column with IF NOT EXISTS', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.posts[\s\S]*ADD COLUMN IF NOT EXISTS comment_count integer NOT NULL DEFAULT 0/,
    )
  })

  it('defines handle_comment_count_change trigger function', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.handle_comment_count_change\(\)/,
    )
  })

  it('trigger function is SECURITY DEFINER', () => {
    expect(migration).toMatch(/handle_comment_count_change[\s\S]*SECURITY DEFINER/)
  })

  it('trigger function locks search_path to public, pg_temp', () => {
    expect(migration).toMatch(
      /handle_comment_count_change[\s\S]*SET search_path = public, pg_temp/,
    )
  })

  it('increments comment_count on INSERT', () => {
    expect(migration).toMatch(/comment_count\s*=\s*comment_count\s*\+\s*1/)
  })

  it('decrements comment_count on DELETE / soft-delete', () => {
    expect(migration).toMatch(/comment_count\s*=\s*comment_count\s*-\s*1/)
  })

  it('handles UPDATE of deleted_at NULL -> NOT NULL (soft delete)', () => {
    expect(migration).toMatch(
      /OLD\.deleted_at IS NULL AND NEW\.deleted_at IS NOT NULL/,
    )
  })

  it('handles UPDATE of deleted_at NOT NULL -> NULL (restore)', () => {
    expect(migration).toMatch(
      /OLD\.deleted_at IS NOT NULL AND NEW\.deleted_at IS NULL/,
    )
  })

  it('creates AFTER INSERT/UPDATE OF deleted_at/DELETE trigger named comments_count_trigger', () => {
    expect(migration).toMatch(
      /CREATE TRIGGER comments_count_trigger[\s\S]*AFTER INSERT OR UPDATE OF deleted_at OR DELETE ON public\.comments/,
    )
  })

  it('trigger calls handle_comment_count_change', () => {
    expect(migration).toMatch(
      /EXECUTE FUNCTION public\.handle_comment_count_change\(\)/,
    )
  })

  it('defines comment_depth_for_parent(uuid) RPC', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.comment_depth_for_parent\(p_parent uuid\)/,
    )
  })

  it('depth RPC uses a recursive CTE walking parent_comment_id', () => {
    expect(migration).toMatch(/WITH RECURSIVE[\s\S]*parent_comment_id/)
  })

  it('depth RPC has an explicit cycle guard (bounded termination)', () => {
    // The FK on comments.parent_comment_id does not prevent id =
    // parent_comment_id self-cycles or multi-row cycles, which would loop
    // the recursive CTE forever. Require Postgres `CYCLE id` syntax.
    expect(migration).toMatch(/CYCLE\s+id\s+SET\s+is_cycle\s+USING\s+path/)
    expect(migration).toMatch(/WHERE\s+NOT\s+is_cycle/)
  })

  it('depth RPC returns NULL (not 0) when the parent does not exist', () => {
    // NULLIF(count(*)::integer, 0) lets the application layer distinguish
    // "parent missing" from "parent is a root with depth 1".
    expect(migration).toMatch(/NULLIF\(count\(\*\)::integer,\s*0\)/)
  })

  it('depth RPC is SECURITY DEFINER with locked search_path', () => {
    expect(migration).toMatch(
      /comment_depth_for_parent[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/,
    )
  })

  it('grants execute on depth RPC to anon, authenticated, service_role', () => {
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.comment_depth_for_parent\(uuid\)[\s\S]*anon[\s\S]*authenticated[\s\S]*service_role/,
    )
  })

  it('backfills comment_count from existing comments', () => {
    expect(migration).toMatch(
      /UPDATE public\.posts[\s\S]*SET comment_count[\s\S]*FROM public\.comments[\s\S]*deleted_at IS NULL/,
    )
  })
})

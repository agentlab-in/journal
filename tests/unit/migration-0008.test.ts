import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let migration: string

beforeAll(() => {
  migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/0008_engagement_counts.sql'),
    'utf8',
  )
})

describe('0008_engagement_counts.sql shape', () => {
  // -------------------------------------------------------------------------
  // Columns
  // -------------------------------------------------------------------------
  it('adds posts.like_count column with IF NOT EXISTS', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.posts[\s\S]*ADD COLUMN IF NOT EXISTS like_count integer NOT NULL DEFAULT 0/,
    )
  })

  it('adds posts.bookmark_count column with IF NOT EXISTS', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.posts[\s\S]*ADD COLUMN IF NOT EXISTS bookmark_count integer NOT NULL DEFAULT 0/,
    )
  })

  it('adds users.follower_count column with IF NOT EXISTS', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.users[\s\S]*ADD COLUMN IF NOT EXISTS follower_count integer NOT NULL DEFAULT 0/,
    )
  })

  it('adds users.following_count column with IF NOT EXISTS', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.users[\s\S]*ADD COLUMN IF NOT EXISTS following_count integer NOT NULL DEFAULT 0/,
    )
  })

  // -------------------------------------------------------------------------
  // handle_like_count_change
  // -------------------------------------------------------------------------
  it('defines handle_like_count_change trigger function', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.handle_like_count_change\(\)/,
    )
  })

  it('handle_like_count_change is SECURITY DEFINER with locked search_path', () => {
    expect(migration).toMatch(
      /handle_like_count_change[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/,
    )
  })

  it('handle_like_count_change increments on INSERT and decrements on DELETE', () => {
    expect(migration).toMatch(
      /handle_like_count_change[\s\S]*TG_OP = 'INSERT'[\s\S]*like_count\s*=\s*like_count\s*\+\s*1[\s\S]*WHERE id = NEW\.post_id/,
    )
    expect(migration).toMatch(
      /handle_like_count_change[\s\S]*TG_OP = 'DELETE'[\s\S]*like_count\s*=\s*like_count\s*-\s*1[\s\S]*WHERE id = OLD\.post_id/,
    )
  })

  it('creates AFTER INSERT OR DELETE trigger likes_count_trigger on public.likes', () => {
    expect(migration).toMatch(
      /CREATE TRIGGER likes_count_trigger[\s\S]*AFTER INSERT OR DELETE ON public\.likes[\s\S]*EXECUTE FUNCTION public\.handle_like_count_change\(\)/,
    )
  })

  // -------------------------------------------------------------------------
  // handle_bookmark_count_change
  // -------------------------------------------------------------------------
  it('defines handle_bookmark_count_change trigger function', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.handle_bookmark_count_change\(\)/,
    )
  })

  it('handle_bookmark_count_change is SECURITY DEFINER with locked search_path', () => {
    expect(migration).toMatch(
      /handle_bookmark_count_change[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/,
    )
  })

  it('handle_bookmark_count_change increments on INSERT and decrements on DELETE', () => {
    expect(migration).toMatch(
      /handle_bookmark_count_change[\s\S]*TG_OP = 'INSERT'[\s\S]*bookmark_count\s*=\s*bookmark_count\s*\+\s*1[\s\S]*WHERE id = NEW\.post_id/,
    )
    expect(migration).toMatch(
      /handle_bookmark_count_change[\s\S]*TG_OP = 'DELETE'[\s\S]*bookmark_count\s*=\s*bookmark_count\s*-\s*1[\s\S]*WHERE id = OLD\.post_id/,
    )
  })

  it('creates AFTER INSERT OR DELETE trigger bookmarks_count_trigger on public.bookmarks', () => {
    expect(migration).toMatch(
      /CREATE TRIGGER bookmarks_count_trigger[\s\S]*AFTER INSERT OR DELETE ON public\.bookmarks[\s\S]*EXECUTE FUNCTION public\.handle_bookmark_count_change\(\)/,
    )
  })

  // -------------------------------------------------------------------------
  // handle_follow_count_change — single function, both sides
  // -------------------------------------------------------------------------
  it('defines handle_follow_count_change trigger function', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.handle_follow_count_change\(\)/,
    )
  })

  it('handle_follow_count_change is SECURITY DEFINER with locked search_path', () => {
    expect(migration).toMatch(
      /handle_follow_count_change[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/,
    )
  })

  it('handle_follow_count_change INSERT increments follower_count for followed_id', () => {
    expect(migration).toMatch(
      /handle_follow_count_change[\s\S]*TG_OP = 'INSERT'[\s\S]*follower_count\s*=\s*follower_count\s*\+\s*1[\s\S]*WHERE id = NEW\.followed_id/,
    )
  })

  it('handle_follow_count_change INSERT increments following_count for follower_id', () => {
    expect(migration).toMatch(
      /handle_follow_count_change[\s\S]*TG_OP = 'INSERT'[\s\S]*following_count\s*=\s*following_count\s*\+\s*1[\s\S]*WHERE id = NEW\.follower_id/,
    )
  })

  it('handle_follow_count_change DELETE decrements follower_count for followed_id', () => {
    expect(migration).toMatch(
      /handle_follow_count_change[\s\S]*TG_OP = 'DELETE'[\s\S]*follower_count\s*=\s*follower_count\s*-\s*1[\s\S]*WHERE id = OLD\.followed_id/,
    )
  })

  it('handle_follow_count_change DELETE decrements following_count for follower_id', () => {
    expect(migration).toMatch(
      /handle_follow_count_change[\s\S]*TG_OP = 'DELETE'[\s\S]*following_count\s*=\s*following_count\s*-\s*1[\s\S]*WHERE id = OLD\.follower_id/,
    )
  })

  it('creates AFTER INSERT OR DELETE trigger follows_count_trigger on public.follows', () => {
    expect(migration).toMatch(
      /CREATE TRIGGER follows_count_trigger[\s\S]*AFTER INSERT OR DELETE ON public\.follows[\s\S]*EXECUTE FUNCTION public\.handle_follow_count_change\(\)/,
    )
  })

  // -------------------------------------------------------------------------
  // DROP TRIGGER IF EXISTS guards (idempotent re-run)
  // -------------------------------------------------------------------------
  it('guards each CREATE TRIGGER with DROP TRIGGER IF EXISTS', () => {
    expect(migration).toMatch(
      /DROP TRIGGER IF EXISTS likes_count_trigger ON public\.likes/,
    )
    expect(migration).toMatch(
      /DROP TRIGGER IF EXISTS bookmarks_count_trigger ON public\.bookmarks/,
    )
    expect(migration).toMatch(
      /DROP TRIGGER IF EXISTS follows_count_trigger ON public\.follows/,
    )
  })

  // -------------------------------------------------------------------------
  // Backfills
  // -------------------------------------------------------------------------
  it('backfills posts.like_count from existing likes', () => {
    expect(migration).toMatch(
      /UPDATE public\.posts[\s\S]*SET like_count[\s\S]*FROM public\.likes[\s\S]*l\.post_id = p\.id/,
    )
  })

  it('backfills posts.bookmark_count from existing bookmarks', () => {
    expect(migration).toMatch(
      /UPDATE public\.posts[\s\S]*SET bookmark_count[\s\S]*FROM public\.bookmarks[\s\S]*b\.post_id = p\.id/,
    )
  })

  it('backfills users.follower_count and following_count from existing follows', () => {
    expect(migration).toMatch(
      /UPDATE public\.users[\s\S]*SET follower_count[\s\S]*f\.followed_id = u\.id[\s\S]*following_count[\s\S]*f\.follower_id = u\.id/,
    )
  })
})

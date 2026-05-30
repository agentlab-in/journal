import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let migration: string

beforeAll(() => {
  migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/0010_search_posts_rpc.sql'),
    'utf8',
  )
})

describe('0010_search_posts_rpc.sql shape', () => {
  it('declares the search_posts function with the expected signature', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.search_posts\(\s*p_q text,\s*p_limit integer DEFAULT 50,\s*p_type text DEFAULT NULL,\s*p_tag_slugs text\[\] DEFAULT NULL\s*\)/,
    )
  })

  it('returns the columns the page expects', () => {
    for (const col of [
      'id',
      'author_id',
      'type',
      'slug',
      'title',
      'summary',
      'snippet',
      'published_at',
      'like_count',
      'bookmark_count',
      'comment_count',
      'rank',
    ]) {
      expect(migration).toMatch(new RegExp(`\\b${col}\\b`))
    }
  })

  it('is SECURITY DEFINER with locked search_path', () => {
    expect(migration).toMatch(/SECURITY DEFINER/)
    expect(migration).toMatch(/SET search_path = public, pg_temp/)
  })

  it('uses websearch_to_tsquery against the english config', () => {
    expect(migration).toMatch(/websearch_to_tsquery\('english',\s*coalesce\(p_q, ''\)\)/)
  })

  it('ranks with ts_rank_cd over posts.search_tsv', () => {
    expect(migration).toMatch(/ts_rank_cd\(p\.search_tsv,\s*\(SELECT tsq FROM q\)\)\s+AS rank/)
  })

  it('generates a snippet with ts_headline and <mark> delimiters', () => {
    expect(migration).toMatch(/ts_headline\(/)
    expect(migration).toMatch(/StartSel=<mark>,StopSel=<\/mark>/)
  })

  it('excludes soft-deleted and future-dated posts', () => {
    expect(migration).toMatch(/p\.deleted_at IS NULL/)
    expect(migration).toMatch(/p\.published_at <= now\(\)/)
  })

  it('filters by type when p_type is supplied', () => {
    expect(migration).toMatch(/p_type IS NULL OR p\.type = p_type/)
  })

  it('filters by tag_slugs when p_tag_slugs is supplied', () => {
    expect(migration).toMatch(
      /p_tag_slugs IS NULL[\s\S]*EXISTS\s*\([\s\S]*public\.post_tags pt[\s\S]*pt\.tag_slug = ANY\(p_tag_slugs\)/,
    )
  })

  it('orders by rank DESC then published_at DESC then id DESC', () => {
    expect(migration).toMatch(
      /ORDER BY rank DESC, p\.published_at DESC, p\.id DESC/,
    )
  })

  it('caps the limit non-negatively with GREATEST', () => {
    expect(migration).toMatch(/LIMIT GREATEST\(p_limit, 0\)/)
  })

  it('grants EXECUTE to anon, authenticated, service_role', () => {
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.search_posts\(text, integer, text, text\[\]\)\s*TO anon, authenticated, service_role/,
    )
  })
})

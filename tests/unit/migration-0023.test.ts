import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let migration: string

beforeAll(() => {
  migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/0023_posts_published_idx.sql'),
    'utf8',
  )
})

describe('0023_posts_published_idx.sql shape', () => {
  it('creates posts_published_idx with IF NOT EXISTS (idempotent re-run)', () => {
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS posts_published_idx/,
    )
  })

  it('indexes public.posts on published_at DESC', () => {
    expect(migration).toMatch(
      /posts_published_idx[\s\S]*ON public\.posts \(published_at DESC\)/,
    )
  })

  it('is a partial index scoped to live (non-deleted) rows', () => {
    expect(migration).toMatch(
      /posts_published_idx[\s\S]*WHERE deleted_at IS NULL/,
    )
  })

  it('does not use CONCURRENTLY (stays transaction-safe like sibling migrations)', () => {
    expect(migration).not.toMatch(/CREATE INDEX CONCURRENTLY/)
  })
})

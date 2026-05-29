import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let migration: string

beforeAll(() => {
  migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/0004_view_count_rpc.sql'),
    'utf8',
  )
})

describe('0004_view_count_rpc.sql shape', () => {
  it('creates the increment_post_view_count function with CREATE OR REPLACE', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.increment_post_view_count\(p_id uuid\)/,
    )
  })

  it('function is declared SECURITY DEFINER', () => {
    expect(migration).toMatch(/SECURITY DEFINER/)
  })

  it('function sets search_path = public, pg_temp (defense pattern)', () => {
    expect(migration).toMatch(/SET search_path = public, pg_temp/)
  })

  it('increments view_count atomically in the UPDATE body', () => {
    expect(migration).toMatch(/view_count\s*=\s*view_count\s*\+\s*1/)
  })

  it('guards against soft-deleted posts (deleted_at IS NULL)', () => {
    expect(migration).toMatch(/deleted_at IS NULL/)
  })

  it('grants execute to anon, authenticated, and service_role', () => {
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.increment_post_view_count\(uuid\)/)
    expect(migration).toMatch(/anon/)
    expect(migration).toMatch(/authenticated/)
    expect(migration).toMatch(/service_role/)
  })
})

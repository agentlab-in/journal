import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let migration: string

beforeAll(() => {
  migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/0025_public_launch_hardening.sql'),
    'utf8',
  )
})

describe('0025_public_launch_hardening.sql shape', () => {
  it('F4: revokes anon EXECUTE on increment_post_view_count', () => {
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.increment_post_view_count\(uuid\) FROM anon;/,
    )
  })

  it('F11: recreates "posts: public read non-deleted" with published_at <= now()', () => {
    expect(migration).toMatch(
      /DROP POLICY IF EXISTS "posts: public read non-deleted" ON public\.posts;/,
    )
    const policyMatch = migration.match(
      /CREATE POLICY "posts: public read non-deleted"[\s\S]+?TO anon, authenticated[\s\S]+?USING \(([\s\S]+?)\);/,
    )
    expect(policyMatch).not.toBeNull()
    const usingClause = policyMatch![1]
    expect(usingClause).toMatch(/deleted_at IS NULL/)
    expect(usingClause).toMatch(/published_at <= now\(\)/)
  })

  it('F11: keeps the 0017 org-visibility EXISTS clause (the F11 add did not drop it)', () => {
    const policyMatch = migration.match(
      /CREATE POLICY "posts: public read non-deleted"[\s\S]+?USING \(([\s\S]+?)\);/,
    )
    expect(policyMatch).not.toBeNull()
    const usingClause = policyMatch![1]
    expect(usingClause).toMatch(
      /EXISTS \(\s*SELECT 1 FROM public\.orgs o\s*WHERE o\.id = posts\.org_id/,
    )
    expect(usingClause).toMatch(/o\.deleted_at IS NULL/)
    expect(usingClause).toMatch(/o\.banned_at IS NULL/)
  })

  it('F12: drops the dead unconditional users public-read policy', () => {
    expect(migration).toMatch(
      /DROP POLICY IF EXISTS "users: public read" ON public\.users;/,
    )
  })
})

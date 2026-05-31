import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let migration: string

beforeAll(() => {
  migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/0012_signup_flags.sql'),
    'utf8',
  )
})

describe('0012_signup_flags.sql shape', () => {
  it('targets the public.users table', () => {
    expect(migration).toMatch(/alter table public\.users/i)
  })

  it('adds signup_flags jsonb column with IF NOT EXISTS', () => {
    expect(migration).toMatch(
      /add column if not exists signup_flags jsonb/i,
    )
  })

  it('includes a COMMENT ON COLUMN statement for signup_flags', () => {
    expect(migration).toMatch(
      /comment on column public\.users\.signup_flags is/i,
    )
  })

  it('comment documents NULL vs {} vs populated semantics', () => {
    expect(migration).toMatch(/NULL/)
    expect(migration).toMatch(/\{\}/)
  })
})

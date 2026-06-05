import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let migration: string

beforeAll(() => {
  migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/0022_consents.sql'),
    'utf8',
  )
})

describe('0022_consents.sql shape', () => {
  it('creates public.consents table', () => {
    expect(migration).toMatch(/CREATE TABLE (IF NOT EXISTS )?public\.consents/)
  })

  it('uses uuid PK with gen_random_uuid default', () => {
    expect(migration).toMatch(/id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/)
  })

  it('user_id is FK to public.users with cascade delete', () => {
    expect(migration).toMatch(
      /user_id uuid NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/,
    )
  })

  it('records the four required boolean and version columns', () => {
    expect(migration).toMatch(/age_confirmed boolean NOT NULL/)
    expect(migration).toMatch(/terms_version text NOT NULL/)
    expect(migration).toMatch(/content_policy_version text NOT NULL/)
    expect(migration).toMatch(/privacy_policy_version text NOT NULL/)
  })

  it('records audit columns (nullable)', () => {
    expect(migration).toMatch(/ip_address text/)
    expect(migration).toMatch(/user_agent text/)
  })

  it('consented_at defaults to now()', () => {
    expect(migration).toMatch(/consented_at timestamptz NOT NULL DEFAULT now\(\)/)
  })

  it('creates a unique index on (user_id, version triple)', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX[\s\S]+consents[\s\S]+\(user_id, terms_version, content_policy_version, privacy_policy_version\)/,
    )
  })

  it('creates a latest-consent lookup index', () => {
    expect(migration).toMatch(
      /CREATE INDEX[\s\S]+consents[\s\S]+\(user_id, consented_at DESC\)/,
    )
  })

  it('enables RLS', () => {
    expect(migration).toMatch(/ALTER TABLE public\.consents ENABLE ROW LEVEL SECURITY/)
  })

  it('creates a self-read policy for authenticated', () => {
    expect(migration).toMatch(
      /CREATE POLICY[\s\S]+ON public\.consents[\s\S]+FOR SELECT[\s\S]+TO authenticated[\s\S]+USING \(user_id = auth\.uid\(\)\)/,
    )
  })
})

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isReserved, RESERVED_USERNAMES } from '@/lib/reserved-names'

// Eight tags ship pre-approved with the platform (see 0002_content.sql §17).
const SEED_TAG_SLUGS = [
  'security',
  'local-first',
  'orchestration',
  'memory',
  'evals',
  'tooling',
  'prompting',
  'multi-agent',
] as const

// Tables defined in 0002_content.sql §1–§14, with RLS enabled in §15.
const PUBLIC_TABLES = [
  'users',
  'posts',
  'post_versions',
  'tags',
  'post_tags',
  'post_references',
  'likes',
  'bookmarks',
  'follows',
  'comments',
  'reports',
  'pinned_posts',
  'mod_actions',
] as const

let migration: string

beforeAll(() => {
  migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/0002_content.sql'),
    'utf8',
  )
})

describe('tag-slug ∩ reserved usernames', () => {
  // Tag slugs and usernames share the URL namespace via /tag/<slug> vs
  // /<username>. If a featured tag's slug collides with a reserved username,
  // the routing intent is ambiguous. None should overlap.
  it.each(SEED_TAG_SLUGS)('seed tag "%s" is not a reserved username', (slug) => {
    expect(isReserved(slug)).toBe(false)
  })

  it('no reserved username collides with a seeded tag slug', () => {
    const tagSet = new Set<string>(SEED_TAG_SLUGS)
    const collisions = [...RESERVED_USERNAMES].filter((name) => tagSet.has(name))
    expect(collisions).toEqual([])
  })
})

describe('0002_content.sql shape', () => {
  it('creates every public table from the spec', () => {
    for (const table of PUBLIC_TABLES) {
      expect(
        migration,
        `migration should CREATE TABLE public.${table}`,
      ).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`))
    }
  })

  it('enables RLS on every public table', () => {
    for (const table of PUBLIC_TABLES) {
      expect(
        migration,
        `migration should ENABLE ROW LEVEL SECURITY on public.${table}`,
      ).toMatch(
        new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`),
      )
    }
  })

  it('grants service_role full access on every public table', () => {
    for (const table of PUBLIC_TABLES) {
      expect(
        migration,
        `service_role full access policy missing for public.${table}`,
      ).toMatch(new RegExp(`"${table}: service_role full access"`))
    }
  })

  it('declares the FTS generated tsvector column on posts', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS search_tsv tsvector/)
    expect(migration).toMatch(/GENERATED ALWAYS AS \(/)
    expect(migration).toMatch(/to_tsvector\('english'/)
  })

  it('creates a GIN index on posts.search_tsv', () => {
    expect(migration).toMatch(/USING gin \(search_tsv\)/)
  })

  it('installs the sync_user_from_next_auth trigger on next_auth.users', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.sync_user_from_next_auth/)
    expect(migration).toMatch(
      /CREATE TRIGGER sync_user_from_next_auth_trigger[\s\S]*?ON next_auth\.users/,
    )
  })

  it('caps post_versions at 20 per post via trigger', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.cap_post_versions/)
    expect(migration).toMatch(/OFFSET 20/)
  })

  it('enforces no-self-follow', () => {
    expect(migration).toMatch(/CHECK \(follower_id <> followed_id\)/)
  })

  it('provisions storage buckets covers + post-images at 2MB cap', () => {
    expect(migration).toMatch(/INSERT INTO storage\.buckets/)
    expect(migration).toMatch(/'covers'/)
    expect(migration).toMatch(/'post-images'/)
    // 2 * 1024 * 1024 = 2097152
    expect(migration).toMatch(/2097152/)
  })

  it('seeds eight featured tags pre-approved', () => {
    // Anchored on the seed INSERT block so deleting it would fail this test,
    // not just deleting `is_approved` from the column definition elsewhere.
    const seedBlockMatch = migration.match(
      /INSERT INTO public\.tags \(slug, name, is_approved, approved_at\)\s*VALUES\s*([\s\S]*?)ON CONFLICT \(slug\) DO NOTHING;/,
    )
    expect(seedBlockMatch, 'seed-tag INSERT block missing').not.toBeNull()
    const seedBlock = seedBlockMatch![1]
    for (const slug of SEED_TAG_SLUGS) {
      expect(seedBlock, `seed tag "${slug}" missing from seed block`).toContain(
        `'${slug}'`,
      )
      // Each tag row sets is_approved = true.
      expect(seedBlock).toMatch(
        new RegExp(`'${slug}',[^,]+,\\s*true`, 'i'),
      )
    }
  })
})

describe('RLS intent', () => {
  // Owner-only tables expose neither anon nor authenticated public read.
  // Reads gate on next_auth.uid() = user_id.
  it.each(['likes', 'bookmarks'])(
    '%s gates reads on next_auth.uid() = user_id',
    (table) => {
      const re = new RegExp(
        `POLICY "${table}: read own"[\\s\\S]*?ON public\\.${table}[\\s\\S]*?USING \\(user_id = next_auth\\.uid\\(\\)\\)`,
      )
      expect(migration).toMatch(re)
    },
  )

  it('follows gates reads on either side of the edge', () => {
    expect(migration).toMatch(
      /POLICY "follows: read own"[\s\S]*?USING \(follower_id = next_auth\.uid\(\) OR followed_id = next_auth\.uid\(\)\)/,
    )
  })

  it('posts public-read excludes soft-deleted rows', () => {
    expect(migration).toMatch(
      /POLICY "posts: public read non-deleted"[\s\S]*?USING \(deleted_at IS NULL\)/,
    )
  })

  it('tags public-read requires is_approved = true', () => {
    expect(migration).toMatch(
      /POLICY "tags: public read approved"[\s\S]*?USING \(is_approved = true\)/,
    )
  })

  it('reports public-read is gated to the reporter', () => {
    expect(migration).toMatch(
      /POLICY "reports: reporter reads own"[\s\S]*?USING \(reporter_id = next_auth\.uid\(\)\)/,
    )
  })

  it('mod_actions has no public read policy (service_role only)', () => {
    // Only one policy block for mod_actions: service_role full access.
    const blocks = migration.match(/POLICY "mod_actions:[^"]+"/g) ?? []
    expect(blocks).toEqual(['POLICY "mod_actions: service_role full access"'])
  })
})

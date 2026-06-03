import { describe, it, expect, beforeAll, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Migration shape assertions — these read the 0013 SQL as a string and assert
// structural shape via regex (no live DB required), matching the style of
// migration-0008.test.ts / migration-0012.test.ts.
// ---------------------------------------------------------------------------

let migration: string

beforeAll(() => {
  migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/0013_orgs.sql'),
    'utf8',
  )
})

describe('0013_orgs.sql — public.orgs', () => {
  it('creates the orgs table with required columns', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.orgs/)
    expect(migration).toMatch(/id\s+uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/)
    expect(migration).toMatch(/slug\s+text NOT NULL UNIQUE CHECK \(slug = lower\(slug\)\)/)
    expect(migration).toMatch(
      /display_name\s+text NOT NULL CHECK \(length\(display_name\) BETWEEN 1 AND 60\)/,
    )
    expect(migration).toMatch(/bio\s+text CHECK \(bio IS NULL OR length\(bio\) <= 500\)/)
    expect(migration).toMatch(/avatar_url\s+text/)
    expect(migration).toMatch(/cover_image_url\s+text/)
    expect(migration).toMatch(
      /created_by_user_id\s+uuid NOT NULL REFERENCES public\.users \(id\) ON DELETE RESTRICT/,
    )
    expect(migration).toMatch(/deleted_at\s+timestamptz/)
    expect(migration).toMatch(/banned_at\s+timestamptz/)
    expect(migration).toMatch(/banned_reason\s+text/)
    expect(migration).toMatch(
      /banned_by\s+uuid REFERENCES public\.users \(id\) ON DELETE SET NULL/,
    )
  })

  it('includes the orgs_ban_consistent CHECK constraint', () => {
    expect(migration).toMatch(
      /CONSTRAINT orgs_ban_consistent CHECK \([\s\S]*banned_at IS NULL AND banned_by IS NULL AND banned_reason IS NULL[\s\S]*OR banned_at IS NOT NULL[\s\S]*\)/,
    )
  })

  it('creates the orgs_slug_idx and partial orgs_banned_idx', () => {
    expect(migration).toMatch(/CREATE INDEX IF NOT EXISTS orgs_slug_idx ON public\.orgs \(slug\)/)
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS orgs_banned_idx[\s\S]*ON public\.orgs \(banned_at\)[\s\S]*WHERE banned_at IS NOT NULL/,
    )
  })
})

describe('0013_orgs.sql — public.org_members', () => {
  it('creates org_members with composite PK and role CHECK', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.org_members/)
    expect(migration).toMatch(/role\s+text NOT NULL CHECK \(role IN \('admin', 'member'\)\)/)
    expect(migration).toMatch(/PRIMARY KEY \(org_id, user_id\)/)
  })

  it('creates the user-side reverse index org_members_user_idx', () => {
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS org_members_user_idx ON public\.org_members \(user_id\)/,
    )
  })

  it('defines the zero-admin trigger function with SECURITY DEFINER + locked search_path', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.org_members_prevent_zero_admins\(\)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/,
    )
  })

  it('zero-admin trigger raises check_violation when last admin would be removed', () => {
    expect(migration).toMatch(
      /org_members_prevent_zero_admins[\s\S]*RAISE EXCEPTION[\s\S]*USING ERRCODE = 'check_violation'/,
    )
  })

  it('registers BEFORE UPDATE OR DELETE trigger on public.org_members', () => {
    expect(migration).toMatch(
      /CREATE TRIGGER org_members_prevent_zero_admins_trigger[\s\S]*BEFORE UPDATE OR DELETE ON public\.org_members[\s\S]*EXECUTE FUNCTION public\.org_members_prevent_zero_admins\(\)/,
    )
  })
})

describe('0013_orgs.sql — public.posts.org_id', () => {
  it('adds posts.org_id with ON DELETE RESTRICT', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.posts ADD COLUMN IF NOT EXISTS org_id uuid[\s\S]*REFERENCES public\.orgs \(id\) ON DELETE RESTRICT/,
    )
  })

  it('creates the partial posts_org_published_idx', () => {
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS posts_org_published_idx[\s\S]*ON public\.posts \(org_id, published_at DESC\)[\s\S]*WHERE deleted_at IS NULL AND org_id IS NOT NULL/,
    )
  })
})

describe('0013_orgs.sql — public.pinned_posts XOR refactor', () => {
  it('drops the old user-only PK and the position-unique constraint', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.pinned_posts DROP CONSTRAINT IF EXISTS pinned_posts_pkey/,
    )
    expect(migration).toMatch(
      /ALTER TABLE public\.pinned_posts DROP CONSTRAINT IF EXISTS pinned_posts_position_unique/,
    )
  })

  it('drops NOT NULL on user_id', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.pinned_posts ALTER COLUMN user_id DROP NOT NULL/,
    )
  })

  it('adds the synthetic UUID PK column', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.pinned_posts ADD COLUMN IF NOT EXISTS id uuid[\s\S]*PRIMARY KEY DEFAULT gen_random_uuid\(\)/,
    )
  })

  it('adds the user/org XOR check', () => {
    expect(migration).toMatch(
      /ADD CONSTRAINT pinned_posts_user_xor_org[\s\S]*CHECK \(\(user_id IS NOT NULL\) <> \(org_id IS NOT NULL\)\)/,
    )
  })

  it('creates the two COALESCE-based unique indexes', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS pinned_posts_owner_post_unique[\s\S]*ON public\.pinned_posts \(COALESCE\(user_id, org_id\), post_id\)/,
    )
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS pinned_posts_owner_position_unique[\s\S]*ON public\.pinned_posts \(COALESCE\(user_id, org_id\), position\)/,
    )
  })
})

describe('0013_orgs.sql — reports / mod_actions target_type extension', () => {
  it("reports target_type CHECK includes 'org'", () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.reports[\s\S]*ADD CONSTRAINT reports_target_type_check[\s\S]*CHECK \(target_type IN \('post', 'comment', 'user', 'org'\)\)/,
    )
  })

  it("mod_actions target_type CHECK includes 'org'", () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.mod_actions[\s\S]*ADD CONSTRAINT mod_actions_target_type_check[\s\S]*CHECK \(target_type IN \('post', 'comment', 'user', 'tag', 'report', 'org'\)\)/,
    )
  })
})

describe('0013_orgs.sql — RLS', () => {
  it('enables RLS on orgs and org_members', () => {
    expect(migration).toMatch(/ALTER TABLE public\.orgs ENABLE ROW LEVEL SECURITY/)
    expect(migration).toMatch(/ALTER TABLE public\.org_members ENABLE ROW LEVEL SECURITY/)
  })

  it('orgs has service_role + public-read policies', () => {
    expect(migration).toMatch(/CREATE POLICY "orgs: service_role full access"/)
    expect(migration).toMatch(
      /CREATE POLICY "orgs: public read non-deleted non-banned"[\s\S]*USING \(deleted_at IS NULL AND banned_at IS NULL\)/,
    )
  })

  it('org_members policy gates roster read by membership via next_auth.uid()', () => {
    expect(migration).toMatch(
      /CREATE POLICY "org_members: member reads own org roster"[\s\S]*EXISTS \([\s\S]*SELECT 1 FROM public\.org_members m[\s\S]*m\.user_id = next_auth\.uid\(\)/,
    )
  })

  it('posts read policy is dropped and recreated with org-soft-delete/ban exclusion', () => {
    expect(migration).toMatch(
      /DROP POLICY IF EXISTS "posts: public read non-deleted" ON public\.posts/,
    )
    expect(migration).toMatch(
      /CREATE POLICY "posts: public read non-deleted"[\s\S]*o\.deleted_at IS NULL[\s\S]*AND o\.banned_at IS NULL/,
    )
  })
})

// ---------------------------------------------------------------------------
// checkSlugCollision — mocked Supabase client. We mock the admin helper so the
// function under test sees a stub client whose chained .from().select().eq()
// returns resolve a maybeSingle promise.
// ---------------------------------------------------------------------------

interface MockRow { id: string }

let usersResult: { data: MockRow | null } = { data: null }
let orgsResult: { data: MockRow | null } = { data: null }
let isReservedReturn = false

vi.mock('@/lib/reserved-names', () => ({
  isReserved: (s: string) => {
    void s
    return isReservedReturn
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => {
    const buildQuery = (table: 'users' | 'orgs') => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => (table === 'users' ? usersResult : orgsResult),
        }),
      }),
    })
    return {
      from: (table: string) => buildQuery(table as 'users' | 'orgs'),
    }
  },
}))

describe('checkSlugCollision', () => {
  beforeEach(() => {
    usersResult = { data: null }
    orgsResult = { data: null }
    isReservedReturn = false
  })

  it("returns 'reserved' when isReserved is true", async () => {
    isReservedReturn = true
    const { checkSlugCollision } = await import('@/lib/slug-collisions')
    expect(await checkSlugCollision('admin')).toBe('reserved')
  })

  it("returns 'username_taken' when users query finds a row", async () => {
    usersResult = { data: { id: 'u1' } }
    const { checkSlugCollision } = await import('@/lib/slug-collisions')
    expect(await checkSlugCollision('harshit')).toBe('username_taken')
  })

  it("returns 'org_slug_taken' when orgs query finds a row", async () => {
    orgsResult = { data: { id: 'o1' } }
    const { checkSlugCollision } = await import('@/lib/slug-collisions')
    expect(await checkSlugCollision('composio')).toBe('org_slug_taken')
  })

  it('returns null when nothing collides', async () => {
    const { checkSlugCollision } = await import('@/lib/slug-collisions')
    expect(await checkSlugCollision('freshname')).toBe(null)
  })
})

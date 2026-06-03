import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAnonServerSupabaseClient } from '@/lib/supabase/server'
import type { PostType } from '@/lib/posts/url'

export interface ProfileUser {
  id: string
  username: string
  display_name: string
  bio: string | null
  avatar_url: string | null
  github_login: string | null
  created_at: string
  follower_count: number
  following_count: number
}

export interface ProfilePostTag {
  slug: string
  name: string
  is_approved: boolean
}

export interface ProfilePost {
  id: string
  type: PostType
  slug: string
  title: string
  summary: string
  cover_image_url: string | null
  published_at: string
  view_count: number
  comment_count: number
  tags: ProfilePostTag[]
}

export interface PinnedProfilePost extends ProfilePost {
  position: number
}

interface UserRow {
  id: string
  username: string
  display_name: string
  bio: string | null
  avatar_url: string | null
  github_login: string | null
  created_at: string
  follower_count: number | null
  following_count: number | null
}

interface PostTagRow {
  tag_slug: string
  tags: {
    slug: string
    name: string
    is_approved: boolean
  }
}

interface PostRow {
  id: string
  type: string
  slug: string
  title: string
  summary: string
  cover_image_url: string | null
  published_at: string
  view_count: number
  comment_count: number
  deleted_at: string | null
  post_tags: PostTagRow[]
}

interface PinnedRow {
  position: number
  posts: PostRow | null
}

const POST_SELECT =
  'id, type, slug, title, summary, cover_image_url, published_at, view_count, comment_count, deleted_at, ' +
  'post_tags(tag_slug, tags(slug, name, is_approved))'

function mapTags(post: PostRow): ProfilePostTag[] {
  return (post.post_tags ?? []).map((pt) => ({
    slug: pt.tags.slug,
    name: pt.tags.name,
    is_approved: pt.tags.is_approved,
  }))
}

function mapPost(post: PostRow): ProfilePost {
  return {
    id: post.id,
    type: post.type as PostType,
    slug: post.slug,
    title: post.title,
    summary: post.summary,
    cover_image_url: post.cover_image_url,
    published_at: post.published_at,
    view_count: post.view_count,
    comment_count: post.comment_count ?? 0,
    tags: mapTags(post),
  }
}

/**
 * Look up a profile by canonical (lowercase) username.
 *
 * Returns null when the username contains uppercase letters (the route
 * handler should already have canonicalized first) or when no user row
 * matches. Reads from `public.users_public` — the safe projection view
 * over `public.users` that excludes ban + signup-flag columns (migration
 * 0014). Anon, authenticated, and service-role clients all work; anon
 * is the right default since no private columns are needed here.
 */
export async function lookupProfileByUsername(
  db: Pick<SupabaseClient, 'from'>,
  username: string,
): Promise<ProfileUser | null> {
  if (username !== username.toLowerCase()) return null

  const { data, error } = await db
    .from('users_public')
    .select(
      'id, username, display_name, bio, avatar_url, github_login, created_at, follower_count, following_count',
    )
    .eq('username', username)
    .maybeSingle()

  if (error || !data) return null
  const row = data as unknown as UserRow

  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    bio: row.bio,
    avatar_url: row.avatar_url,
    github_login: row.github_login,
    created_at: row.created_at,
    follower_count: row.follower_count ?? 0,
    following_count: row.following_count ?? 0,
  }
}

/**
 * Fetch up to 6 pinned posts for a profile, ordered by pin position.
 * Soft-deleted posts and rows whose joined post is missing are skipped.
 */
export async function getPinnedPosts(
  db: Pick<SupabaseClient, 'from'>,
  userId: string,
): Promise<PinnedProfilePost[]> {
  const { data, error } = await db
    .from('pinned_posts')
    .select(`position, posts(${POST_SELECT})`)
    .eq('user_id', userId)
    .order('position', { ascending: true })
    .limit(6)

  if (error || !data) return []
  const rows = data as unknown as PinnedRow[]

  const out: PinnedProfilePost[] = []
  for (const r of rows) {
    const p = r.posts
    if (!p) continue
    if (p.deleted_at !== null && p.deleted_at !== undefined) continue
    out.push({ ...mapPost(p), position: r.position })
  }
  return out
}

/**
 * Fetch all non-deleted posts authored by a user, newest first.
 */
export async function getAuthoredPosts(
  db: Pick<SupabaseClient, 'from'>,
  userId: string,
): Promise<ProfilePost[]> {
  const { data, error } = await db
    .from('posts')
    .select(POST_SELECT)
    .eq('author_id', userId)
    .is('deleted_at', null)
    .order('published_at', { ascending: false })

  if (error || !data) return []
  const rows = data as unknown as PostRow[]
  return rows.map(mapPost)
}

/**
 * Request-scoped cached profile lookup. Server components and
 * generateMetadata share a single DB roundtrip.
 */
export const getCachedProfile = cache(
  async (username: string): Promise<ProfileUser | null> => {
    return lookupProfileByUsername(createAnonServerSupabaseClient(), username)
  },
)

// ---------------------------------------------------------------------------
// Phase 11 — Org profiles
//
// Orgs share the `/[username]` route with users. The leading URL segment
// resolves to a user first, then to an org by slug. Soft-deleted and
// banned orgs are treated as absent at the read layer (mirrors the
// public-read RLS policy on `public.orgs`) so callers can 404 uniformly.
// ---------------------------------------------------------------------------

export interface ProfileOrg {
  id: string
  slug: string
  display_name: string
  bio: string | null
  avatar_url: string | null
  cover_image_url: string | null
  created_at: string
}

interface OrgRow {
  id: string
  slug: string
  display_name: string
  bio: string | null
  avatar_url: string | null
  cover_image_url: string | null
  created_at: string
  deleted_at: string | null
  banned_at: string | null
}

/**
 * Look up a publishable org profile by slug. Returns null when the slug
 * is mixed-case, no row matches, or the org is soft-deleted / banned.
 */
export async function lookupOrgBySlug(
  db: Pick<SupabaseClient, 'from'>,
  slug: string,
): Promise<ProfileOrg | null> {
  if (slug !== slug.toLowerCase()) return null

  const { data, error } = await db
    .from('orgs')
    .select(
      'id, slug, display_name, bio, avatar_url, cover_image_url, created_at, deleted_at, banned_at',
    )
    .eq('slug', slug)
    .maybeSingle()

  if (error || !data) return null
  const row = data as unknown as OrgRow
  if (row.deleted_at !== null || row.banned_at !== null) return null

  return {
    id: row.id,
    slug: row.slug,
    display_name: row.display_name,
    bio: row.bio,
    avatar_url: row.avatar_url,
    cover_image_url: row.cover_image_url,
    created_at: row.created_at,
  }
}

/**
 * Request-scoped cached org lookup. Mirrors getCachedProfile so the page
 * + generateMetadata share a single DB roundtrip.
 */
export const getCachedOrg = cache(
  async (slug: string): Promise<ProfileOrg | null> => {
    return lookupOrgBySlug(createAnonServerSupabaseClient(), slug)
  },
)

/**
 * Fetch up to 6 pinned posts for an org, ordered by pin position.
 * Mirrors getPinnedPosts but scoped to org_id (the pinned_posts row
 * owner column was split into user_id XOR org_id in migration 0013).
 */
export async function getOrgPinnedPosts(
  db: Pick<SupabaseClient, 'from'>,
  orgId: string,
): Promise<PinnedProfilePost[]> {
  const { data, error } = await db
    .from('pinned_posts')
    .select(`position, posts(${POST_SELECT})`)
    .eq('org_id', orgId)
    .order('position', { ascending: true })
    .limit(6)

  if (error || !data) return []
  const rows = data as unknown as PinnedRow[]

  const out: PinnedProfilePost[] = []
  for (const r of rows) {
    const p = r.posts
    if (!p) continue
    if (p.deleted_at !== null && p.deleted_at !== undefined) continue
    out.push({ ...mapPost(p), position: r.position })
  }
  return out
}

/**
 * Fetch all non-deleted posts authored under an org, newest first.
 * Mirrors getAuthoredPosts but filtered by org_id rather than author_id.
 */
export async function getOrgPosts(
  db: Pick<SupabaseClient, 'from'>,
  orgId: string,
): Promise<ProfilePost[]> {
  const { data, error } = await db
    .from('posts')
    .select(POST_SELECT)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('published_at', { ascending: false })

  if (error || !data) return []
  const rows = data as unknown as PostRow[]
  return rows.map(mapPost)
}

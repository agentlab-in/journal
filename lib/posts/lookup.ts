import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isPostType } from './url'
import type { PostType } from './url'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export interface LookupParams {
  username: string // raw URL segment, may be mixed case
  type: string // raw URL segment, may not be a valid PostType
  slug: string // raw URL segment
}

export interface LookedUpPost {
  id: string
  author_id: string
  /**
   * Non-null when the post is authored under an org. Used by the post
   * page to switch JSON-LD publisher to the org and to render the
   * org-prominent byline.
   */
  org_id: string | null
  type: PostType
  slug: string
  title: string
  summary: string
  body_html: string
  cover_image_url: string | null
  structured_sections: Record<string, string | null> | null
  comment_count: number
  like_count: number
  published_at: string
  edited_at: string | null
  author: {
    id: string
    username: string
    display_name: string
    avatar_url: string | null
    bio: string | null
  }
  /**
   * Hydrated for org-authored posts (post.org_id IS NOT NULL) when the
   * org is active (not soft-deleted, not banned). Active-org filtering
   * happens here because the lookup uses a service-role client that
   * bypasses RLS — see Phase 11 brainstorm "404 the post" decision.
   */
  org: {
    id: string
    slug: string
    display_name: string
    avatar_url: string | null
  } | null
  tags: Array<{ slug: string; name: string; is_approved: boolean }>
}

interface UserRow {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  bio: string | null
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
  author_id: string
  org_id: string | null
  type: string
  slug: string
  title: string
  summary: string
  body_html: string
  cover_image_url: string | null
  structured_sections: Record<string, string | null> | null
  comment_count: number
  like_count: number
  published_at: string
  edited_at: string | null
  deleted_at: string | null
  post_tags: PostTagRow[]
}

interface OrgLookupRow {
  id: string
  slug: string
  display_name: string
  avatar_url: string | null
  deleted_at: string | null
  banned_at: string | null
}

const POST_SELECT_COLUMNS = `id, author_id, org_id, type, slug, title, summary, body_html,
  cover_image_url, structured_sections, comment_count, like_count,
  published_at, edited_at, deleted_at,
  post_tags(tag_slug, tags(slug, name, is_approved))`

/**
 * Fetch a single published post.
 *
 * The leading URL segment (`params.username`) resolves to a user OR an
 * org. Resolution order is user-first, then org. Personal posts are
 * scoped to `org_id IS NULL` so an org-authored post NEVER leaks via the
 * author's personal username — it is only reachable at
 * `/<org-slug>/<type>/<slug>` (the canonical URL the publish API
 * already emits).
 *
 * Returns null if:
 * - `params.type` is not a valid PostType
 * - `params.username` contains uppercase letters (non-canonical URL)
 * - no user or org matches the leading segment
 * - no post matches the (owner, type, slug) triple
 * - the post has been soft-deleted
 * - the owning org is soft-deleted or banned (manual cascade — the
 *   service-role client bypasses RLS, so we re-apply the public-read
 *   guard here)
 *
 * @param db Must be a service-role client. The post-detail page renders
 *   unapproved tags muted (the `tag-pending` class on app/[username]/[type]/[slug]/page.tsx);
 *   RLS on `public.tags` hides unapproved rows from anon/authenticated, so
 *   the anon client would silently drop those joined tags from the response.
 *   We keep this on service-role despite the M14 audit finding because the
 *   page UX intentionally surfaces pending tags to the post author and
 *   moderators, and switching here would regress that. The user/post columns
 *   we read are otherwise public (no banned_at / signup_flags), and
 *   public.users_public (migration 0014) is used for the author projection
 *   as defense-in-depth in case the client is ever passed an anon client.
 */
export async function lookupPost(
  db: Pick<SupabaseClient, 'from'>,
  params: LookupParams,
): Promise<LookedUpPost | null> {
  // 1. Validate type
  if (!isPostType(params.type)) return null

  // 2. Reject mixed-case leading segments (canonical URLs are lowercase)
  if (params.username !== params.username.toLowerCase()) return null

  // Step 1: try user by username via the safe-projection view —
  // see migration 0014_rls_hardening.sql.
  //
  // Throw on a genuine DB error rather than collapsing it to a null
  // "not found". `getCachedPost` wraps this in `unstable_cache` (600s TTL),
  // so a null born from a transient error would be cached and 404 a live
  // post for up to 10 minutes. Throwing keeps the failure out of the data
  // cache — the next request retries — while a clean `maybeSingle()` miss
  // (data null, error null) still returns null as before.
  const { data: userData, error: userError } = await db
    .from('users_public')
    .select('id, username, display_name, avatar_url, bio')
    .eq('username', params.username)
    .maybeSingle()
  if (userError) throw userError

  const user = (userData ?? null) as UserRow | null

  if (user) {
    // Personal-post path: org_id MUST be null so org-authored posts
    // don't leak via the author's username (canonical URL uses org slug).
    const { data: postData, error: postError } = await db
      .from('posts')
      .select(POST_SELECT_COLUMNS)
      .eq('author_id', user.id)
      .is('org_id', null)
      .eq('type', params.type)
      .eq('slug', params.slug)
      .is('deleted_at', null)
      .maybeSingle()

    if (postError) throw postError
    if (!postData) return null
    const post = postData as unknown as PostRow
    if (post.deleted_at !== null && post.deleted_at !== undefined) return null

    return buildLookedUpPost(post, user, null)
  }

  // Step 2: leading segment didn't match a user — try org by slug.
  const { data: orgData, error: orgError } = await db
    .from('orgs')
    .select('id, slug, display_name, avatar_url, deleted_at, banned_at')
    .eq('slug', params.username)
    .maybeSingle()
  if (orgError) throw orgError

  const org = (orgData ?? null) as OrgLookupRow | null
  if (!org) return null
  // Cascade visibility: 404 posts under soft-deleted / banned orgs.
  if (org.deleted_at !== null || org.banned_at !== null) return null

  const { data: postData, error: postError } = await db
    .from('posts')
    .select(POST_SELECT_COLUMNS)
    .eq('org_id', org.id)
    .eq('type', params.type)
    .eq('slug', params.slug)
    .is('deleted_at', null)
    .maybeSingle()

  if (postError) throw postError
  if (!postData) return null
  const post = postData as unknown as PostRow
  if (post.deleted_at !== null && post.deleted_at !== undefined) return null

  // The org-authored post still has an author — fetch the author row so
  // the byline can show "by @author" alongside the org-prominent name.
  const { data: authorData, error: authorError } = await db
    .from('users')
    .select('id, username, display_name, avatar_url, bio')
    .eq('id', post.author_id)
    .maybeSingle()
  if (authorError) throw authorError

  const author = (authorData ?? null) as UserRow | null
  if (!author) return null

  return buildLookedUpPost(post, author, {
    id: org.id,
    slug: org.slug,
    display_name: org.display_name,
    avatar_url: org.avatar_url,
  })
}

function buildLookedUpPost(
  post: PostRow,
  user: UserRow,
  org: {
    id: string
    slug: string
    display_name: string
    avatar_url: string | null
  } | null,
): LookedUpPost {
  const tags = (post.post_tags ?? []).map((pt) => ({
    slug: pt.tags.slug,
    name: pt.tags.name,
    is_approved: pt.tags.is_approved,
  }))

  return {
    id: post.id,
    author_id: post.author_id,
    org_id: post.org_id,
    type: post.type as PostType,
    slug: post.slug,
    title: post.title,
    summary: post.summary,
    body_html: post.body_html,
    cover_image_url: post.cover_image_url,
    structured_sections: post.structured_sections,
    comment_count: post.comment_count ?? 0,
    like_count: post.like_count ?? 0,
    published_at: post.published_at,
    edited_at: post.edited_at,
    author: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      bio: user.bio,
    },
    org,
    tags,
  }
}

/**
 * Cross-request cached lookup, built from two layers:
 *
 *   1. `unstable_cache` (Next data cache) — caches the resolved post across
 *      requests and viewers. Post content is viewer-independent (the page's
 *      per-viewer bits — liked/bookmarked/owner/admin — are fetched
 *      separately), so a single shared entry is correct for everyone. This
 *      is the same caching model as `lib/feed/discovery-cache.ts`: a 600 s
 *      TTL safety net plus the `['posts']` tag, which the post-mutation
 *      routes already invalidate via `revalidateTag('posts', { expire: 0 })`
 *      on create / update (app/api/posts/route.ts, [id]/route.ts) and
 *      delete / restore — so an edit is reflected on the very next request.
 *
 *      Staleness window: `like_count` rides along in the cached row and
 *      lags up to the TTL, the same trade-off the cached home rails
 *      already accept.
 *
 *   2. React `cache` — request-scoped memoization so `generateMetadata` and
 *      the page body share a single resolution within one render pass
 *      (and don't hit the data cache twice).
 *
 * The cache key is the `['post-lookup-v1']` prefix plus the serialized
 * `params` (username/type/slug) that `unstable_cache` appends automatically.
 */
const fetchPostFromDb = unstable_cache(
  async (params: LookupParams): Promise<LookedUpPost | null> => {
    return lookupPost(createAdminSupabaseClient(), params)
  },
  ['post-lookup-v1'],
  { revalidate: 600, tags: ['posts'] },
)

export const getCachedPost = cache(
  async (params: LookupParams): Promise<LookedUpPost | null> => {
    return fetchPostFromDb(params)
  },
)

import { cache } from 'react'
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
  type: PostType
  slug: string
  title: string
  summary: string
  body_html: string
  cover_image_url: string | null
  structured_sections: Record<string, string | null> | null
  view_count: number
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
  type: string
  slug: string
  title: string
  summary: string
  body_html: string
  cover_image_url: string | null
  structured_sections: Record<string, string | null> | null
  view_count: number
  comment_count: number
  like_count: number
  published_at: string
  edited_at: string | null
  deleted_at: string | null
  post_tags: PostTagRow[]
}

/**
 * Fetch a single published post by author username, post type, and slug.
 *
 * Returns null if:
 * - `params.type` is not a valid PostType
 * - `params.username` contains uppercase letters (non-canonical URL)
 * - no user or post matches the given params
 * - the post has been soft-deleted
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

  // 2. Reject mixed-case usernames (canonical URLs are lowercase)
  if (params.username !== params.username.toLowerCase()) return null

  // Step 1: look up user by username via the safe-projection view —
  // see migration 0014_rls_hardening.sql.
  const { data: userData, error: userError } = await db
    .from('users_public')
    .select('id, username, display_name, avatar_url, bio')
    .eq('username', params.username)
    .maybeSingle()

  if (userError || !userData) return null
  const user = userData as unknown as UserRow

  // Step 2: look up post by author_id, type, slug
  const { data: postData, error: postError } = await db
    .from('posts')
    .select(
      `id, author_id, type, slug, title, summary, body_html,
      cover_image_url, structured_sections, view_count, comment_count, like_count,
      published_at, edited_at, deleted_at,
      post_tags(tag_slug, tags(slug, name, is_approved))`,
    )
    .eq('author_id', user.id)
    .eq('type', params.type)
    .eq('slug', params.slug)
    .is('deleted_at', null)
    .maybeSingle()

  if (postError || !postData) return null
  const post = postData as unknown as PostRow

  // 4. Explicit deleted_at guard (belt-and-suspenders; .is('deleted_at', null) already covers this)
  if (post.deleted_at !== null && post.deleted_at !== undefined) return null

  // Flatten post_tags into flat tag array
  const tags = (post.post_tags ?? []).map((pt) => ({
    slug: pt.tags.slug,
    name: pt.tags.name,
    is_approved: pt.tags.is_approved,
  }))

  return {
    id: post.id,
    author_id: post.author_id,
    type: post.type as PostType,
    slug: post.slug,
    title: post.title,
    summary: post.summary,
    body_html: post.body_html,
    cover_image_url: post.cover_image_url,
    structured_sections: post.structured_sections,
    view_count: post.view_count,
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
    tags,
  }
}

/**
 * Request-scoped cached lookup. Use this in server components so that
 * both `generateMetadata` and the page body share a single DB roundtrip.
 * Internally calls `lookupPost` against a fresh admin client.
 */
export const getCachedPost = cache(
  async (params: LookupParams): Promise<LookedUpPost | null> => {
    return lookupPost(createAdminSupabaseClient(), params)
  },
)

import type { SupabaseClient } from '@supabase/supabase-js'
import { isPostType } from './url'
import type { PostType } from './url'

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
 * @param db Must be a service-role client. RLS on the `tags` table filters
 *   out unapproved rows for non-service-role clients; pages render unapproved
 *   tags muted, so a non-service-role caller would silently lose them.
 */
export async function lookupPost(
  db: Pick<SupabaseClient, 'from'>,
  params: LookupParams,
): Promise<LookedUpPost | null> {
  // 1. Validate type
  if (!isPostType(params.type)) return null

  // 2. Reject mixed-case usernames (canonical URLs are lowercase)
  if (params.username !== params.username.toLowerCase()) return null

  // Step 1: look up user by username
  const { data: userData, error: userError } = await db
    .from('users')
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
      cover_image_url, structured_sections, view_count,
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

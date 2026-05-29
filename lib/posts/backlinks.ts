import type { SupabaseClient } from '@supabase/supabase-js'
import type { PostType } from './url'

export interface Backlink {
  id: string
  title: string
  type: PostType
  slug: string
  author_username: string
}

interface ReferenceRow {
  source_post_id: string
}

interface PostRow {
  id: string
  title: string
  type: string
  slug: string
  published_at: string
  deleted_at: string | null
  users: { username: string } | null
}

/**
 * Fetch the posts that reference `targetPostId` via wikilinks.
 * Excludes deleted source posts. Sorted by source post `published_at DESC`.
 */
export async function fetchBacklinks(
  db: Pick<SupabaseClient, 'from'>,
  targetPostId: string,
): Promise<Backlink[]> {
  // Step 1: fetch all post_references pointing at targetPostId
  const { data: refData, error: refError } = await db
    .from('post_references')
    .select('source_post_id')
    .eq('target_post_id', targetPostId)

  if (refError || !refData || refData.length === 0) {
    return []
  }

  const refs = refData as unknown as ReferenceRow[]
  const sourceIds = refs.map((r) => r.source_post_id)

  // Step 2: fetch the source posts (non-deleted), joining users
  const { data: postData, error: postError } = await db
    .from('posts')
    .select('id, title, type, slug, published_at, deleted_at, users(username)')
    .in('id', sourceIds)
    .is('deleted_at', null)
    .order('published_at', { ascending: false })

  if (postError || !postData) {
    return []
  }

  const posts = postData as unknown as PostRow[]

  const backlinks: Backlink[] = []
  for (const p of posts) {
    // Defensive: skip rows with no user join (author was deleted)
    if (!p.users || !p.users.username) continue
    // Defensive: skip deleted (belt-and-suspenders; .is('deleted_at', null) covers this)
    if (p.deleted_at !== null && p.deleted_at !== undefined) continue

    backlinks.push({
      id: p.id,
      title: p.title,
      type: p.type as PostType,
      slug: p.slug,
      author_username: p.users.username,
    })
  }

  return backlinks
}

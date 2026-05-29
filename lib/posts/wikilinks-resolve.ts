import type { SupabaseClient } from '@supabase/supabase-js'
import { slug as toSlug } from './slug'
import type { PostType } from './url'

export interface ResolveOpts {
  db: Pick<SupabaseClient, 'from'>
  currentUserId: string
}

export interface ResolvedAnchor {
  targetPostId: string
  targetUsername: string
  targetType: PostType
  targetSlug: string
}

interface Row {
  id: string
  author_id: string
  slug: string
  type: string
  published_at: string
  users: { username: string } | null
  likes: { count: number }[]
}

export async function resolveAnchor(
  anchor: string,
  opts: ResolveOpts,
): Promise<ResolvedAnchor | null> {
  const target = toSlug(anchor)
  if (!target) return null

  const { data, error } = await opts.db
    .from('posts')
    .select(
      'id, author_id, slug, type, published_at, users!inner(username), likes(count)',
    )
    .eq('slug', target)
    .is('deleted_at', null)

  if (error || !data || data.length === 0) return null

  const rows = data as unknown as Row[]
  rows.sort((a, b) => {
    const aMine = a.author_id === opts.currentUserId ? 1 : 0
    const bMine = b.author_id === opts.currentUserId ? 1 : 0
    if (aMine !== bMine) return bMine - aMine
    const aLikes = a.likes[0]?.count ?? 0
    const bLikes = b.likes[0]?.count ?? 0
    if (aLikes !== bLikes) return bLikes - aLikes
    return b.published_at.localeCompare(a.published_at)
  })

  const top = rows[0]
  if (!top.users) return null
  return {
    targetPostId: top.id,
    targetUsername: top.users.username,
    targetType: top.type as PostType,
    targetSlug: top.slug,
  }
}

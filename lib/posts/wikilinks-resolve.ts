import type { SupabaseClient } from '@supabase/supabase-js'
import { slug as toSlug } from './slug'
import type { PostType } from './url'

export interface ResolveOpts {
  db: Pick<SupabaseClient, 'from'>
  currentUserId: string
}

/**
 * Result of resolving a `[[wikilink]]` anchor to a post.
 *
 * `targetLeadingSegment` is what the URL builder prepends — the org slug
 * when the target post was published under an org, otherwise the author's
 * username. Callers should treat it as the opaque first path segment so
 * they don't need to branch on org vs personal authorship.
 *
 * (The previous shape used `targetUsername` for this slot; renamed in
 * Phase 11 / T5 so org-authored targets resolve to the org's vanity URL
 * without forcing every caller to branch.)
 */
export interface ResolvedAnchor {
  targetPostId: string
  targetLeadingSegment: string
  targetType: PostType
  targetSlug: string
}

interface Row {
  id: string
  author_id: string
  org_id: string | null
  slug: string
  type: string
  published_at: string
  like_count: number
  users: { username: string } | null
  orgs: { slug: string } | null
}

function pickTop(rows: Row[], currentUserId: string): Row | null {
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => {
    const aMine = a.author_id === currentUserId ? 1 : 0
    const bMine = b.author_id === currentUserId ? 1 : 0
    if (aMine !== bMine) return bMine - aMine
    const aLikes = a.like_count ?? 0
    const bLikes = b.like_count ?? 0
    if (aLikes !== bLikes) return bLikes - aLikes
    return b.published_at.localeCompare(a.published_at)
  })
  return sorted[0]
}

function toResolved(row: Row): ResolvedAnchor | null {
  if (!row.users) return null
  return {
    targetPostId: row.id,
    // Prefer org slug when the post is published under an org — same precedence
    // the publish path uses when building post URLs.
    targetLeadingSegment: row.orgs?.slug ?? row.users.username,
    targetType: row.type as PostType,
    targetSlug: row.slug,
  }
}

export async function resolveAnchor(
  anchor: string,
  opts: ResolveOpts,
): Promise<ResolvedAnchor | null> {
  const target = toSlug(anchor)
  if (!target) return null

  // `orgs` is a LEFT join — most posts have org_id = NULL and we still
  // want them to resolve. The inner-join on users mirrors the prior
  // behaviour: an author row is required for the post URL.
  const { data, error } = await opts.db
    .from('posts')
    .select(
      'id, author_id, org_id, slug, type, published_at, like_count, users!inner(username), orgs(slug)',
    )
    .eq('slug', target)
    .is('deleted_at', null)

  if (error || !data || data.length === 0) return null

  const top = pickTop(data as unknown as Row[], opts.currentUserId)
  return top ? toResolved(top) : null
}

/**
 * Batched anchor resolution: one round-trip for the whole list. Previously
 * the publish path looped `resolveAnchor` per anchor, which on a body with
 * N `[[...]]` translated to N sequential Supabase queries — turning a
 * thousand-anchor body (now capped upstream at 100, but the fix and the
 * cap were paired) into a thousand-RTT publish. The batched form keeps
 * the same ranking semantics: per anchor we pick the row whose slug
 * matches, then sort by (mine, likes desc, published_at desc).
 *
 * Returns a Map keyed by the original anchor string (NOT the slugified
 * form) so call sites can look up by the in-body token directly.
 */
export async function resolveAnchors(
  anchors: string[],
  opts: ResolveOpts,
): Promise<Map<string, ResolvedAnchor>> {
  const result = new Map<string, ResolvedAnchor>()
  if (anchors.length === 0) return result

  // anchor → slug. Skip anchors that slugify to empty.
  const slugByAnchor = new Map<string, string>()
  const slugSet = new Set<string>()
  for (const anchor of anchors) {
    const s = toSlug(anchor)
    if (!s) continue
    slugByAnchor.set(anchor, s)
    slugSet.add(s)
  }
  if (slugSet.size === 0) return result

  const { data, error } = await opts.db
    .from('posts')
    .select(
      'id, author_id, org_id, slug, type, published_at, like_count, users!inner(username), orgs(slug)',
    )
    .in('slug', [...slugSet])
    .is('deleted_at', null)

  if (error || !data) return result

  const rowsBySlug = new Map<string, Row[]>()
  for (const row of data as unknown as Row[]) {
    const bucket = rowsBySlug.get(row.slug)
    if (bucket) bucket.push(row)
    else rowsBySlug.set(row.slug, [row])
  }

  for (const [anchor, s] of slugByAnchor) {
    const rows = rowsBySlug.get(s)
    if (!rows) continue
    const top = pickTop(rows, opts.currentUserId)
    if (!top) continue
    const resolved = toResolved(top)
    if (resolved) result.set(anchor, resolved)
  }

  return result
}

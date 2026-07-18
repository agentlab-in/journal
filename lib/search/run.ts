/**
 * Run a full-text search against the `search_posts` RPC (migration 0010).
 *
 * The RPC composes `websearch_to_tsquery` + `ts_rank_cd` ranking +
 * `ts_headline` snippet generation in a single round-trip. We keep the
 * call-site thin: any error is logged and swallowed (the page renders
 * the empty state) so a flaky DB never throws the whole page.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PostType } from '@/lib/posts/url'
import type { ParsedSearchParams } from './query'

const DEFAULT_LIMIT = 50

export interface SearchHit {
  id: string
  author_id: string
  type: PostType
  slug: string
  title: string
  summary: string
  /**
   * `ts_headline` output. Contains literal `<mark>…</mark>` fragments
   * which the renderer MUST sanitize — `ts_headline` will happily echo
   * other HTML in the source body verbatim. Never pipe this into
   * `dangerouslySetInnerHTML` directly.
   */
  snippet: string
  published_at: string
  rank: number
}

/**
 * Call the `search_posts` RPC and return zero or more ranked hits.
 *
 * Returns `[]` on any error so callers can fall through to the empty
 * state without try/catch. Logs the error to console.error so it shows
 * up in the server logs.
 */
export async function runSearch(
  db: Pick<SupabaseClient, 'rpc'>,
  params: { q: string; type: ParsedSearchParams['type']; tags: string[] },
  options: { limit?: number } = {},
): Promise<SearchHit[]> {
  const limit = options.limit ?? DEFAULT_LIMIT

  const { data, error } = await db.rpc('search_posts', {
    p_q: params.q,
    p_type: params.type,
    p_tag_slugs: params.tags.length > 0 ? params.tags : null,
    p_limit: limit,
  })

  if (error) {
    console.error('[search] search_posts RPC failed:', error)
    return []
  }
  if (!Array.isArray(data)) return []

  return data as SearchHit[]
}

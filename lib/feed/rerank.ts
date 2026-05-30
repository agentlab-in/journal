/**
 * Pure re-rank pass for the "For You" feed.
 *
 * Takes a shortlist of posts (from `shortlistByHeat`) augmented with each
 * post's approved tag slugs, plus the viewer's tag-affinity set, and
 * computes a new ordering driven by `computeHeatScore` from `lib/heat.ts`.
 * The heat helper already applies a flat +5 numerator boost when
 * `tag_affinity > 0`, so any overlap between a post's tags and the
 * viewer's affinity surfaces it above an otherwise-identical un-matched
 * post.
 *
 * Pure: no I/O, no time except the injectable `now`. Input rows are not
 * mutated — we sort a shallow copy.
 *
 * Tiebreaker on `id` descending so that two posts with bitwise-equal
 * scores have a deterministic ordering. UUIDs sort lexicographically;
 * descending puts the higher-id (typically newer-row) on top.
 */
import { computeHeatScore } from '@/lib/heat'
import type { ShortlistRow } from './shortlist'

const DEFAULT_LIMIT = 30

export interface RerankRow extends ShortlistRow {
  /** Approved tag slugs attached to this post (max 5 per Phase 4). */
  tag_slugs: string[]
}

function overlapCount(rowTags: string[], affinity: Set<string>): number {
  if (rowTags.length === 0 || affinity.size === 0) return 0
  let n = 0
  for (const t of rowTags) if (affinity.has(t)) n += 1
  return n
}

export function rerankWithAffinity(
  rows: RerankRow[],
  affinity: Set<string>,
  options: { limit?: number; now?: Date } = {},
): RerankRow[] {
  const limit = options.limit ?? DEFAULT_LIMIT
  const now = options.now ?? new Date()

  // Score once per row, then sort. Doing the score inside the comparator
  // would recompute it O(N log N) times and break stability guarantees on
  // ties.
  const scored = rows.map((row) => ({
    row,
    score: computeHeatScore(
      {
        published_at: row.published_at,
        like_count: row.like_count,
        bookmark_count: row.bookmark_count,
        tag_affinity: overlapCount(row.tag_slugs, affinity),
      },
      now,
    ),
  }))

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Stable, deterministic tiebreaker. String compare is fine for UUIDs
    // and arbitrary id strings alike.
    if (b.row.id < a.row.id) return -1
    if (b.row.id > a.row.id) return 1
    return 0
  })

  return scored.slice(0, limit).map((s) => s.row)
}

/**
 * Pure heat-score helper used to rank posts in feeds and the home timeline.
 *
 * Mirrors the SQL formulation in `docs/v1-plan.md` (Phase 9, S3) but as a
 * pure TypeScript function with no I/O — callers pass the engagement counts
 * and the viewer's tag affinity already computed. Pure so the same score can
 * be computed in jobs, tests, and (eventually) at request time without
 * round-tripping through Postgres.
 *
 *   score = (like_count + 2 * bookmark_count + tag_affinity_boost)
 *         / pow(hours_since_published + 2, 1.5)
 *
 * `tag_affinity_boost` is +5 when tag_affinity > 0, else 0 — matching the
 * SQL `case when exists(tag overlap) then 5 else 0 end`. Note: the spec's
 * SQL formula also has a `0.5 * comment_count` term; the Phase 8 brief
 * intentionally omits comment_count from this helper's signature, so we
 * omit it here too. (Add comment_count when the consumer can supply it.)
 *
 * `now` is injectable so unit tests are deterministic.
 */
export function computeHeatScore(
  {
    published_at,
    like_count,
    bookmark_count,
    tag_affinity,
  }: {
    published_at: string
    like_count: number
    bookmark_count: number
    tag_affinity: number
  },
  now: Date = new Date(),
): number {
  const tagAffinityBoost = tag_affinity > 0 ? 5 : 0
  const numerator = like_count + 2 * bookmark_count + tagAffinityBoost

  const rawHours = (now.getTime() - Date.parse(published_at)) / 3_600_000
  // Clamp to >= 0 so a future-dated post is treated as freshly published,
  // and fall back to 0 when not finite (e.g. Date.parse returned NaN for a
  // malformed string). Without this, the score becomes NaN or Infinity and
  // silently breaks Array.sort comparators downstream.
  const hoursSincePublished = Number.isFinite(rawHours)
    ? Math.max(rawHours, 0)
    : 0

  // +2 floor matches the SQL formulation so very fresh posts (and the
  // pathological "future post" case) don't blow up to Infinity.
  return numerator / Math.pow(hoursSincePublished + 2, 1.5)
}

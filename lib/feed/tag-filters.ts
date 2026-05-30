/**
 * Pure URL-query filter resolution for the `/tag/[slug]` page.
 *
 * Kept side-effect-free and out of the page module so we can unit-test the
 * parsing + cutoff math without spinning up the whole Next request cycle.
 *
 * The page accepts:
 *   ?type = post | playbook | dive | all     (default 'all')
 *   ?time = all  | 7d  | 30d                  (default 'all')
 *
 * Anything outside the allow-list silently snaps to the default; we never
 * 400 on a poisoned share link.
 */

export const TYPE_FILTERS = ['all', 'post', 'playbook', 'dive'] as const
export type TypeFilter = (typeof TYPE_FILTERS)[number]

export const TIME_FILTERS = ['all', '7d', '30d'] as const
export type TimeFilter = (typeof TIME_FILTERS)[number]

/** Snap an arbitrary string (or `undefined`) to a valid type filter. */
export function resolveTypeFilter(raw: string | undefined): TypeFilter {
  if (typeof raw !== 'string') return 'all'
  return (TYPE_FILTERS as readonly string[]).includes(raw) ? (raw as TypeFilter) : 'all'
}

/** Snap an arbitrary string (or `undefined`) to a valid time filter. */
export function resolveTimeFilter(raw: string | undefined): TimeFilter {
  if (typeof raw !== 'string') return 'all'
  return (TIME_FILTERS as readonly string[]).includes(raw) ? (raw as TimeFilter) : 'all'
}

/**
 * Convert a time filter to an ISO cutoff timestamp. Returns the moment
 * `now - N days`. Caller uses this with `.gte('published_at', cutoff)`.
 *
 * Only callable for the windowed filters — `all` has no cutoff, so the
 * caller should branch on that before reaching here.
 */
export function timeCutoff(filter: Exclude<TimeFilter, 'all'>, now: Date = new Date()): string {
  const days = filter === '7d' ? 7 : 30
  return new Date(now.getTime() - days * 86_400_000).toISOString()
}

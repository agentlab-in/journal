/**
 * Relative time formatter for comment timestamps.
 *
 * Short, single-token output ("just now", "5m ago", "3h ago", "2d ago")
 * for anything inside the last 30 days; falls back to an absolute en-US
 * short date so very old threads don't display as "742d ago". We pin the
 * locale to keep SSR and the first client render byte-identical (same
 * trick used by the post header).
 */
const ABS_FMT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const THIRTY_DAYS = 30 * DAY

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return ''
  const diff = now.getTime() - ts
  if (diff < MIN) return 'just now'
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`
  if (diff < THIRTY_DAYS) return `${Math.floor(diff / DAY)}d ago`
  return ABS_FMT.format(new Date(ts))
}

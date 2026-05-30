/**
 * Cursor-based pagination helpers for the home feed.
 *
 * The feed is ordered by `(published_at DESC, id DESC)`. A cursor captures
 * the last row a page rendered, and the next page asks for rows strictly
 * "older" than that — i.e. `(published_at, id) < (cursor.published_at,
 * cursor.id)` in lexicographic tuple order.
 *
 * Cursors are encoded as URL-safe base64 (`base64url`) JSON so they can be
 * dropped straight into a `?cursor=` query param without further escaping.
 *
 * Decoding is intentionally total (never throws): a poisoned or malformed
 * cursor returns `null` and the render path treats it as "no cursor —
 * serve page 1". This keeps a hostile share link from crashing the page.
 */

// `PostgrestFilterBuilder` is the chain type we mutate at runtime; we only
// reference it in the docstring so we don't have to plumb the four generic
// type parameters Supabase asks for through this helper.

/** Identifies a single feed row for "give me posts older than this". */
export interface FeedCursor {
  /** ISO-8601 timestamp pulled from `posts.published_at`. */
  published_at: string
  /** UUID pulled from `posts.id`. */
  id: string
}

/**
 * Characters that are safe to drop into a PostgREST `.or(...)` filter
 * string without any further escaping. UUIDs (`[0-9a-f-]`) and ISO
 * timestamps (`[0-9T:.+-Z]`) both fit comfortably inside this set; any
 * cursor with a character outside it is treated as poisoned and rejected.
 */
const CURSOR_FIELD_SAFE_RE = /^[A-Za-z0-9:.\-T+Z]+$/

function isSafeCursorField(value: string): boolean {
  return CURSOR_FIELD_SAFE_RE.test(value)
}

/** Base64url-encode a cursor for use as a URL query param. */
export function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

/**
 * Decode a cursor previously produced by {@link encodeCursor}.
 *
 * Returns `null` (never throws) for any of:
 *   - non-base64url input
 *   - base64url that doesn't parse as JSON
 *   - JSON that doesn't have both `{ published_at: string, id: string }`
 *   - a `published_at` that doesn't parse as a Date
 *   - an empty `id`
 *   - either field containing a character outside the safe-set guard
 *     (so a poisoned cursor cannot smuggle PostgREST filter syntax)
 */
export function decodeCursor(raw: string): FeedCursor | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  let parsed: unknown
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  const { published_at, id } = obj
  if (typeof published_at !== 'string' || typeof id !== 'string') return null
  if (id.length === 0) return null
  if (Number.isNaN(new Date(published_at).getTime())) return null
  if (!isSafeCursorField(published_at) || !isSafeCursorField(id)) return null
  return { published_at, id }
}

/**
 * Add the cursor predicate to a Supabase/PostgREST chain.
 *
 * Filter is `(published_at < cursor.published_at) OR (published_at =
 * cursor.published_at AND id < cursor.id)` — the standard lexicographic
 * tuple comparison for keyset pagination on `(published_at DESC, id DESC)`.
 *
 * `cursor` is `null | undefined` for "first page" — the chain is returned
 * untouched so callers can pipe it unconditionally:
 *
 *     applyCursor(db.from('posts').select(...).order(...), cursor).limit(n)
 *
 * Throws if either cursor field contains characters outside the safe set
 * (belt-and-suspenders — `decodeCursor` already enforces this).
 */
export function applyCursor<T extends { or: (...args: unknown[]) => T }>(
  chain: T,
  cursor: FeedCursor | null | undefined,
): T {
  if (!cursor) return chain
  if (!isSafeCursorField(cursor.published_at) || !isSafeCursorField(cursor.id)) {
    throw new Error('applyCursor: cursor contains unsafe characters')
  }
  return chain.or(
    `published_at.lt.${cursor.published_at},and(published_at.eq.${cursor.published_at},id.lt.${cursor.id})`,
  )
}

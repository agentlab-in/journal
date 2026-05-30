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
 * The cursor encodes a `posts.id` (UUID) and a `posts.published_at`
 * (ISO-8601 timestamp). We validate each against its strict shape so that
 * a poisoned cursor can't smuggle a comma, parenthesis, or operator token
 * into the PostgREST `.or(...)` filter string we build in `applyCursor`.
 * UUID-only / ISO-only is stricter than necessary for raw safety, but it
 * matches what `encodeCursor`'s callers ever produce, and the doc claim
 * ("PostgREST filter smuggling impossible") is then literally true.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/

function isSafeId(value: string): boolean {
  return UUID_RE.test(value)
}

function isSafePublishedAt(value: string): boolean {
  return ISO_TS_RE.test(value)
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
  if (!isSafePublishedAt(published_at) || !isSafeId(id)) return null
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
export function applyCursor<T extends { or: (filter: string, ...rest: never[]) => T }>(
  chain: T,
  cursor: FeedCursor | null | undefined,
): T {
  if (!cursor) return chain
  if (!isSafePublishedAt(cursor.published_at) || !isSafeId(cursor.id)) {
    throw new Error('applyCursor: cursor contains unsafe characters')
  }
  return chain.or(
    `published_at.lt.${cursor.published_at},and(published_at.eq.${cursor.published_at},id.lt.${cursor.id})`,
  )
}

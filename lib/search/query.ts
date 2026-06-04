/**
 * Pure URL-query parsing for the `/search` page.
 *
 * Kept side-effect-free and out of the page module so the parsing logic
 * (which has to handle a few odd cases — repeated `tag=` params, garbage
 * `type=` values, missing `q` entirely) is unit-testable without spinning
 * up Next's request cycle.
 *
 * The page accepts:
 *   ?q    = free-text search query           (default '')
 *   ?type = post | playbook | dive           (default null = all types)
 *   ?tag  = slug (repeatable: tag=a&tag=b)   (default [] = all tags)
 *
 * Anything outside the allow-list silently snaps to the default — we never
 * 400 on a poisoned share link.
 */

import { POST_TYPES, type PostType } from '@/lib/posts/url'

export interface ParsedSearchParams {
  q: string
  /** `null` means "all post types". */
  type: PostType | null
  /** Lowercase, deduped, never empty strings. `[]` means "all tags". */
  tags: string[]
}

/**
 * Hard cap on the free-text query. `websearch_to_tsquery` is roughly
 * linear in input length but the upstream RPC has no ceiling of its own;
 * a multi-MB `?q=` would drive needless RPC cost and produce useless
 * snippets. 200 chars comfortably fits any honest search.
 */
export const MAX_Q_LENGTH = 200

/** Pull the single first value out of a string-or-array query param. */
function firstString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

/** Flatten a string-or-array param into an array of strings. */
function asArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Parse the `/search` page's URL query into a normalized shape.
 *
 * Inputs match Next 16's `searchParams` shape — each key may be a string,
 * a string array (repeated params), or undefined (missing).
 */
export function parseSearchParams(input: {
  q?: string | string[]
  type?: string | string[]
  tag?: string | string[]
}): ParsedSearchParams {
  const rawQ = firstString(input.q)
  // Strip NUL defensively (some HTTP stacks let it through) then cap.
  // The cap is enforced here, upstream of `runSearch`, so every search
  // path (page render, future API) inherits it.
  const q =
    typeof rawQ === 'string'
      ? rawQ.replace(/\0/g, '').trim().slice(0, MAX_Q_LENGTH)
      : ''

  const rawType = firstString(input.type)
  const type: PostType | null =
    typeof rawType === 'string' && (POST_TYPES as readonly string[]).includes(rawType)
      ? (rawType as PostType)
      : null

  // Tags: accept array OR repeated query strings. Lowercase, trim, drop
  // empties, then dedupe while preserving first-seen order so the URL the
  // user landed on round-trips deterministically.
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of asArray(input.tag)) {
    if (typeof raw !== 'string') continue
    const t = raw.trim().toLowerCase()
    if (t === '') continue
    if (seen.has(t)) continue
    seen.add(t)
    tags.push(t)
  }

  return { q, type, tags }
}

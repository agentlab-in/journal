/**
 * Phase 14 — Lightweight comment-abuse heuristics.
 *
 * - Honeypot: a hidden form field `_h` that real users never fill but bots
 *   often do. Empty / absent / non-object body → not tripped.
 * - URL-heavy: more than 50% of whitespace-delimited tokens look like URLs.
 *   Existing sanitizer handles empty bodies, so empty input returns false
 *   here (no opinion).
 */

export const HONEYPOT_FIELD = '_h'

export function isHoneypotTripped(body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false
  if (!(HONEYPOT_FIELD in (body as Record<string, unknown>))) return false
  const value = (body as Record<string, unknown>)[HONEYPOT_FIELD]
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'boolean') return value === true
  if (typeof value === 'object') return Object.keys(value).length > 0
  // bigint, symbol, function — treat presence as tripped
  return true
}

const URL_TOKEN_RE = /^https?:\/\/|^www\.|:\/\//i

export function isUrlHeavy(text: string): boolean {
  if (typeof text !== 'string' || text.trim() === '') return false
  const tokens = text.split(/\s+/).filter((t) => t.length > 0)
  if (tokens.length === 0) return false
  const urls = tokens.filter((t) => URL_TOKEN_RE.test(t)).length
  return urls / tokens.length > 0.5
}

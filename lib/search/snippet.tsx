/**
 * Safe-by-construction renderer for `ts_headline` snippets.
 *
 * `ts_headline` returns a string sprinkled with literal `<mark>…</mark>`
 * tags. The naive thing — `dangerouslySetInnerHTML` — would let any HTML
 * inside the post summary slip through into the page. So instead we:
 *
 *   1. Split the string on `<mark>…</mark>`.
 *   2. Strip any tag-shaped substring from each piece (defense for the
 *      edge case where ts_headline outputs malformed markup, or the
 *      summary itself contained `<…>`).
 *   3. Emit alternating plain text and JSX `<mark>` elements.
 *
 * The output is plain React children — never `dangerouslySetInnerHTML` —
 * so XSS is structurally impossible regardless of what comes out of the
 * database.
 */

import type { ReactNode } from 'react'

const MARK_RE = /<mark>([\s\S]*?)<\/mark>/g

/** Remove anything that looks like an HTML tag. */
function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '')
}

/**
 * Render `ts_headline` HTML as React children with `<mark>` highlighting.
 * Returns a string when no marks are present so callers can render the
 * snippet directly inside text-only contexts.
 */
export function renderSnippet(html: string): ReactNode {
  if (typeof html !== 'string' || html.length === 0) return ''

  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0

  // exec() on a /g regex walks the string statefully — keep a fresh
  // regex per call to avoid lastIndex bleed across renders.
  const re = new RegExp(MARK_RE.source, 'g')

  while ((match = re.exec(html)) !== null) {
    if (match.index > lastIndex) {
      parts.push(stripHtml(html.slice(lastIndex, match.index)))
    }
    parts.push(<mark key={i++}>{stripHtml(match[1])}</mark>)
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < html.length) {
    parts.push(stripHtml(html.slice(lastIndex)))
  }

  // If the snippet had no <mark> tags at all, return the cleaned string.
  return parts.length === 0 ? stripHtml(html) : parts
}

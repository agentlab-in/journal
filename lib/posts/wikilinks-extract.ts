const FENCED_CODE_RE = /^```[\s\S]*?^```/gm
const INLINE_CODE_RE = /`[^`\n]*`/g
const WIKILINK_RE = /\[\[([^[\]|\n]+)(?:\|[^[\]\n]+)?\]\]/g

// Hard cap on resolved anchors per post. A hostile/runaway body with
// thousands of `[[...]]` would otherwise translate 1:1 into resolve work
// downstream. 100 is comfortably above any honest authoring need
// (the longest real posts in v1 sit at ~10).
export const MAX_WIKILINK_ANCHORS = 100

export function extractWikilinkAnchors(body_md: string): string[] {
  // Strip fenced and inline code first so anchors inside them are ignored.
  const stripped = body_md
    .replace(FENCED_CODE_RE, '')
    .replace(INLINE_CODE_RE, '')

  const seen = new Map<string, string>()
  let match: RegExpExecArray | null
  WIKILINK_RE.lastIndex = 0
  while ((match = WIKILINK_RE.exec(stripped)) !== null) {
    const anchor = match[1].trim()
    if (!anchor) continue
    const key = anchor.toLowerCase()
    if (!seen.has(key)) seen.set(key, anchor)
    if (seen.size >= MAX_WIKILINK_ANCHORS) break
  }
  const anchors = [...seen.values()]
  if (anchors.length >= MAX_WIKILINK_ANCHORS) {
    console.warn(
      `[wikilinks] truncated to ${MAX_WIKILINK_ANCHORS} anchors (cap hit)`,
    )
  }
  return anchors
}

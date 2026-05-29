const FENCED_CODE_RE = /^```[\s\S]*?^```/gm
const INLINE_CODE_RE = /`[^`\n]*`/g
const WIKILINK_RE = /\[\[([^[\]|\n]+)(?:\|[^[\]\n]+)?\]\]/g

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
  }
  return [...seen.values()]
}

import { renderToHtml } from '@/lib/posts/render'

/**
 * Compile a profile bio (markdown) to sanitized HTML.
 * Wikilinks always resolve to null in bios — they are surfaced as broken
 * spans the same way unresolved post wikilinks are.
 */
export async function renderBioToHtml(bio: string): Promise<string> {
  return renderToHtml(bio, { resolveAnchor: () => null })
}

/**
 * Strip markdown formatting characters from a bio to produce a plain-text
 * description for OpenGraph / meta tags. Best-effort, intentionally simple
 * so it stays cheap to run on every request.
 */
export function bioToPlainText(bio: string, maxLength = 160): string {
  const stripped = bio
    // Code fences
    .replace(/```[\s\S]*?```/g, ' ')
    // Inline code
    .replace(/`([^`]+)`/g, '$1')
    // Images ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Links [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Wikilinks [[text]] → text
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    // Emphasis / strong / strike markers
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    // Headings, blockquotes, list markers at line start
    .replace(/^\s{0,3}(#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+)/gm, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()

  if (stripped.length <= maxLength) return stripped
  return stripped.slice(0, maxLength - 1).trimEnd() + '…'
}

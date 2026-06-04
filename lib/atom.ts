/**
 * Hand-rolled Atom 1.0 serializer.
 *
 * No XML library — Atom is small enough that a string template plus a
 * strict `escapeXml` is safer than pulling in a dep that would also
 * need its own escaping audit.
 *
 * Entry `<content type="html">` carries already-sanitized HTML from
 * `posts.body_html`. Per RFC 4287 §3.1.1.2, html-type content MUST be
 * XML-escaped (not wrapped in CDATA) so feed readers can parse the
 * surrounding XML before they hand the inner text to an HTML parser.
 */

export interface AtomEntry {
  id: string
  url: string
  title: string
  summary: string
  contentHtml: string
  authorName: string
  authorHandle: string
  published: string
  updated: string
}

export interface AtomFeedInput {
  title: string
  description: string
  selfUrl: string
  alternateUrl: string
  // WARNING: don't change the canonical origin (SITE_URL) once feeds
  // are published — readers dedupe entries by <id>, which is derived
  // from absolute URLs.
  feedId: string
  updated: string
  entries: AtomEntry[]
}

// XML 1.0 forbids C0 control chars except \t, \n, \r. A single NUL in
// any user-supplied field would otherwise make every reader reject the
// whole feed. Built via RegExp constructor so the source file stays
// free of literal control bytes.
const XML_ILLEGAL_CONTROL_CHARS = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]',
  'g',
)

function escapeXml(s: string): string {
  // Order matters: strip illegal chars first, then `&` before the
  // other entity replacements so they don't double-escape.
  return s
    .replace(XML_ILLEGAL_CONTROL_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function renderEntry(e: AtomEntry): string {
  const authorLine = `${e.authorName} (@${e.authorHandle})`
  return [
    '  <entry>',
    `    <id>${escapeXml(e.id)}</id>`,
    `    <title>${escapeXml(e.title)}</title>`,
    `    <link rel="alternate" href="${escapeXml(e.url)}"/>`,
    `    <published>${escapeXml(e.published)}</published>`,
    `    <updated>${escapeXml(e.updated)}</updated>`,
    `    <summary>${escapeXml(e.summary)}</summary>`,
    // escapeXml handles XML-context safety only. HTML-context safety of the
    // inner markup relies entirely on the upstream sanitize allowlist in
    // lib/mdx/sanitize.ts — feed readers re-parse the escaped HTML, so
    // anything that allowlist widens to (e.g. <iframe>) WILL be rendered.
    `    <content type="html">${escapeXml(e.contentHtml)}</content>`,
    '    <author>',
    `      <name>${escapeXml(authorLine)}</name>`,
    '    </author>',
    '  </entry>',
  ].join('\n')
}

export function renderAtomFeed(input: AtomFeedInput): string {
  const head = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${escapeXml(input.feedId)}</id>`,
    `  <title>${escapeXml(input.title)}</title>`,
    `  <subtitle>${escapeXml(input.description)}</subtitle>`,
    `  <updated>${escapeXml(input.updated)}</updated>`,
    `  <link rel="self" href="${escapeXml(input.selfUrl)}"/>`,
    `  <link rel="alternate" href="${escapeXml(input.alternateUrl)}"/>`,
  ]

  const body = input.entries.map(renderEntry)

  return [...head, ...body, '</feed>', ''].join('\n')
}

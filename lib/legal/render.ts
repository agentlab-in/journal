// lib/legal/render.ts
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'

import { getLegalDoc, type LegalDoc } from './docs'

export interface RenderedLegalDoc {
  /** Doc body rendered to HTML. The opening H1 is stripped — the page
   * surfaces its own <h1> from the registry title to keep heading
   * structure under tighter control than the markdown body. */
  bodyHtml: string
  /** Effective date parsed from the doc body, ISO 8601 (YYYY-MM-DD). */
  effectiveDate: string
  /** Original effective date string as it appears in the doc (e.g.
   * "June 4, 2026") for user-facing display. */
  effectiveDateLabel: string
}

// `**Effective Date:** June 4, 2026` (trailing spaces are markdown's
// hard-break marker — keep them tolerant).
const EFFECTIVE_DATE_RE = /\*\*Effective Date:\*\*\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
}

function parseEffectiveDate(label: string): string {
  // "June 4, 2026" → "2026-06-04". We do this by hand rather than
  // through `new Date(label)` because the global Date parser is locale-
  // dependent and silently misreads non-US formats in some runtimes.
  const m = label.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/)
  if (!m) throw new Error(`Unparseable effective date: ${label}`)
  const month = MONTHS[m[1].toLowerCase()]
  if (!month) throw new Error(`Unknown month: ${m[1]}`)
  const day = Number(m[2])
  const year = Number(m[3])
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function extractEffectiveDate(body: string): {
  iso: string
  label: string
} {
  const match = body.match(EFFECTIVE_DATE_RE)
  if (!match) {
    throw new Error('Legal doc is missing an "**Effective Date:**" line')
  }
  const label = match[1]
  return { iso: parseEffectiveDate(label), label }
}

async function readLegalSource(doc: LegalDoc): Promise<string> {
  // `process.cwd()` is the Next project root at runtime; the /legal
  // folder is shipped as static source alongside /app.
  const fullPath = path.join(process.cwd(), 'legal', doc.file)
  return readFile(fullPath, 'utf8')
}

async function markdownToHtml(md: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    // Operator-authored content — we trust the source. Skipping the
    // wikilinks + sanitize layers the user-content pipeline uses, since
    // these docs contain plain markdown only (no [[wikilinks]], no raw
    // HTML). If that ever changes, mirror lib/posts/render.ts instead.
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeStringify)
    .process(md)
  return String(file)
}

/** Strip the leading `<h1>...</h1>` tag — the page renders its own. */
function stripLeadingH1(html: string): string {
  return html.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>/, '').trim()
}

export async function renderLegalDoc(
  slug: LegalDoc['slug'],
): Promise<RenderedLegalDoc> {
  const doc = getLegalDoc(slug)
  const source = await readLegalSource(doc)
  const { iso, label } = extractEffectiveDate(source)
  const fullHtml = await markdownToHtml(source)
  return {
    bodyHtml: stripLeadingH1(fullHtml),
    effectiveDate: iso,
    effectiveDateLabel: label,
  }
}

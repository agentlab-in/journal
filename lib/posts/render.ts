// lib/posts/render.ts
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypePrismPlus from 'rehype-prism-plus'
import rehypeSanitize from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import wikilinks from '@/lib/mdx/wikilinks'
import { sanitizeSchema } from '@/lib/mdx/sanitize'

export interface RenderOpts {
  resolveAnchor: (anchor: string) => string | null
}

export async function renderToHtml(
  body_md: string,
  opts: RenderOpts,
): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(wikilinks, {
      resolve: (anchor) => {
        const url = opts.resolveAnchor(anchor)
        return url ? { url } : null
      },
    })
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypePrismPlus, { ignoreMissing: true })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify)
    .process(body_md)
  let html = String(file)
  html = rewriteUnresolvedWikilinks(html)
  return html
}

const STUB_LINK_RE =
  /<a\s+href="\/wikilink-resolve\?title=([^"]+)"[^>]*>([^<]*)<\/a>/g

function rewriteUnresolvedWikilinks(html: string): string {
  return html.replace(STUB_LINK_RE, (_full, _enc, text) => {
    return `<span class="broken-wikilink" title="Unresolved wikilink">${text}</span>`
  })
}

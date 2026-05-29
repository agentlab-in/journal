// next-mdx-remote 5.x — confirmed `serialize` lives at the legacy entry
// point. The RSC entry (`next-mdx-remote/rsc`) merges serialize + render
// for server components, but Phase 3 needs to ship the compiled payload
// to a client `<MDXRemote />` (the editor preview pane), so we keep the
// classic split: server compiles, client hydrates.
import { serialize } from 'next-mdx-remote/serialize'
import type { MDXRemoteSerializeResult } from 'next-mdx-remote'
import remarkGfm from 'remark-gfm'
import rehypePrismPlus from 'rehype-prism-plus'
import rehypeSanitize from 'rehype-sanitize'
import type { Plugin } from 'unified'
import wikilinks from './wikilinks'
import { sanitizeSchema } from './sanitize'

/**
 * Convert MDX-JSX nodes (`mdxJsxFlowElement`, `mdxJsxTextElement`) to
 * plain HAST `element` nodes with lowercase `tagName`. Required because
 * `rehype-sanitize` only walks element/text/comment/doctype/root — any
 * MDX JSX node it sees is silently dropped, including legitimate
 * Callout/Embed/Figure/etc. After this conversion, sanitize prunes
 * disallowed tags and attributes; the surviving lowercase tags map
 * straight onto `mdxComponents`.
 *
 * Only string attribute values are kept — expression attributes like
 * `<Foo bar={something}>` get dropped (they could exfiltrate runtime
 * state and aren't representable as static HTML anyway).
 */
type MdxJsxAttribute = {
  type: 'mdxJsxAttribute'
  name: string
  value: string | null | undefined
}

type AnyNode = {
  type: string
  children?: unknown[]
  name?: string | null
  attributes?: Array<MdxJsxAttribute | { type: string }>
  tagName?: string
  properties?: Record<string, string | boolean | number | null>
} & Record<string, unknown>

const liftMdxJsx: Plugin<[]> = () => {
  return (tree) => {
    const walk = (node: AnyNode) => {
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          if (child && typeof child === 'object') {
            walk(child as AnyNode)
          }
        }
      }
      if (
        node.type === 'mdxJsxFlowElement' ||
        node.type === 'mdxJsxTextElement'
      ) {
        const name = (node.name ?? '').toLowerCase()
        const properties: Record<string, string> = {}
        for (const attr of node.attributes ?? []) {
          const a = attr as MdxJsxAttribute
          if (a.type === 'mdxJsxAttribute' && typeof a.value === 'string') {
            properties[a.name] = a.value
          }
        }
        node.type = 'element'
        node.tagName = name
        node.properties = properties
        delete node.name
        delete node.attributes
      }
    }
    walk(tree as unknown as AnyNode)
  }
}

/**
 * Compile a raw MDX source string into a `<MDXRemote />`-ready payload.
 * Order of operations:
 *   1. remark-gfm     — tables, task lists, autolinks, strikethrough.
 *   2. wikilinks      — `[[Title]]` → `<a href="/wikilink-resolve?...">`.
 *   3. liftMdxJsx     — turn `<Callout>` etc. into plain HAST elements so
 *                       sanitize can see them.
 *   4. rehype-prism-plus — tokenise fenced code with prism (ignoreMissing
 *                       so unknown languages don't throw).
 *   5. rehype-sanitize — apply `sanitizeSchema` (allowlist + class-name
 *                       allowlist + protocol checks).
 */
export function compileMdx(
  source: string,
): Promise<MDXRemoteSerializeResult> {
  return serialize(source, {
    mdxOptions: {
      remarkPlugins: [remarkGfm, wikilinks],
      rehypePlugins: [
        liftMdxJsx,
        [rehypePrismPlus, { ignoreMissing: true }],
        [rehypeSanitize, sanitizeSchema],
      ],
      format: 'mdx',
    },
  })
}

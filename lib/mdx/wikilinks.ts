import type { Plugin } from 'unified'
import type { Root, Text, Link, PhrasingContent, Parent } from 'mdast'
import { visit, SKIP } from 'unist-util-visit'

/**
 * remark plugin that rewrites `[[Title]]` and `[[Title|Alias]]` wikilink
 * syntax inside text nodes into mdast `link` nodes pointing at the Phase 3
 * stub resolver `/wikilink-resolve?title=<encodeURIComponent(title)>`.
 *
 * Rules:
 *  - Only `text` nodes are scanned. `inlineCode` and `code` nodes are left
 *    untouched (their `value` is a string leaf, not a `text` child).
 *  - Pattern: `[[X]]` or `[[X|alias]]`. `X` and `alias` may not contain
 *    `[`, `]`, or newlines. Inside `X`, `|` is also disallowed because it
 *    is the alias separator.
 *  - Empty titles (`[[]]`) and unbalanced brackets (`[[X]`) are not matched.
 *  - The alias is taken literally — whitespace is NOT trimmed.
 *  - Phase 4 will replace the resolver target with a canonical URL at
 *    publish time; this plugin only emits the stub.
 */

const WIKILINK_RE = /\[\[([^[\]|\n]+)(?:\|([^[\]\n]+))?\]\]/g

const wikilinks: Plugin<[], Root> = () => {
  return (tree) => {
    // NOTE: `visit` for the 'text' type never enters `inlineCode` / `code`
    // mdast nodes because those store their content as a string `value`,
    // not as text children. The mdast type system enforces this — see the
    // visit parent typings — so we don't need a runtime parent.type guard.
    visit(tree, 'text', (node: Text, index, parent) => {
      if (parent == null || index == null) return

      const value = node.value
      // Fast-path: skip nodes that obviously contain no wikilink open token.
      if (!value.includes('[[')) return

      const replacements: PhrasingContent[] = []
      let lastIndex = 0
      let match: RegExpExecArray | null
      // Reset because the RE is module-level with the `g` flag.
      WIKILINK_RE.lastIndex = 0

      while ((match = WIKILINK_RE.exec(value)) !== null) {
        const [full, title, alias] = match
        const start = match.index
        const end = start + full.length

        if (start > lastIndex) {
          replacements.push({
            type: 'text',
            value: value.slice(lastIndex, start),
          })
        }

        const display = alias ?? title
        const link: Link = {
          type: 'link',
          url: `/wikilink-resolve?title=${encodeURIComponent(title)}`,
          title: null,
          children: [{ type: 'text', value: display }],
        }
        replacements.push(link)

        lastIndex = end
      }

      // No matches — leave the node alone.
      if (replacements.length === 0) return

      if (lastIndex < value.length) {
        replacements.push({ type: 'text', value: value.slice(lastIndex) })
      }

      const typedParent = parent as Parent
      typedParent.children.splice(
        index,
        1,
        ...(replacements as typeof typedParent.children),
      )
      // Skip the inserted children so we don't reprocess them.
      return [SKIP, index + replacements.length]
    })
  }
}

export default wikilinks

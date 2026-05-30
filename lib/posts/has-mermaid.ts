/**
 * Detect whether a server-rendered post body contains at least one
 * Mermaid fenced code block.
 *
 * The MDX → HTML pipeline (`lib/posts/render.ts`) runs `rehype-prism-plus`
 * before `rehype-sanitize`. For a ```mermaid block this yields a
 * `<code>` whose `class` attribute contains the `language-mermaid` token
 * — but the attribute often carries additional prism tokens
 * (e.g. `class="code-highlight language-mermaid"`), so a naive substring
 * match like `class="language-mermaid"` would miss those.
 *
 * The regex below matches `<code` … `class="…language-mermaid…"` where
 * `language-mermaid` appears as a whole word inside the class list.
 * Anchored to `<code` so an unrelated element that happens to mention
 * the string in text content cannot trigger a false positive.
 *
 * This is the server-side gate used by the post page to decide whether
 * to additionally mount `<MermaidHydratorClient>` (which dynamic-imports
 * the `mermaid` library and mutates the post body in place). When false,
 * neither the hydrator chunk nor mermaid enter the page's bundle graph.
 */
const MERMAID_CODE_RE = /<code[^>]*class="[^"]*\blanguage-mermaid\b/i

export function hasMermaid(html: string): boolean {
  if (!html) return false
  return MERMAID_CODE_RE.test(html)
}

/**
 * Server-rendered, zero-client-JS post body. Every post page renders this
 * — mermaid pages additionally mount `<MermaidHydratorClient>` which
 * mutates the already-rendered HTML in place to swap mermaid code blocks
 * for SVGs. The mermaid hydrator + the `mermaid` library only enter the
 * bundle graph for posts that need them (see `lib/posts/has-mermaid.ts`).
 *
 * The outer `<div className="post-body">` is the anchor the hydrator
 * scopes its `querySelectorAll` to — keep it in sync with the selector
 * in `components/posts/MermaidHydrator.tsx`.
 */
export function PostBodyStatic({ html }: { html: string }) {
  return (
    <div className="post-body" dangerouslySetInnerHTML={{ __html: html }} />
  )
}

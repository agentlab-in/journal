/**
 * Server-rendered, zero-client-JS post body. Used for posts that don't
 * contain a Mermaid block — the `<PostBody>` client component (which
 * lazy-imports mermaid on mount) is only shipped to the browser when the
 * post HTML actually needs it. See `lib/posts/has-mermaid.ts`.
 *
 * Markup parity with `<PostBody>`: same outer `<div className="post-body">`
 * + same `dangerouslySetInnerHTML` payload, so CSS in `app/globals.css`
 * (`.post-body …`) styles both paths identically.
 */
export function PostBodyStatic({ html }: { html: string }) {
  return (
    <div className="post-body" dangerouslySetInnerHTML={{ __html: html }} />
  )
}

import { SANITIZE_VERSION } from '@/lib/mdx/sanitize'

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
 *
 * H12 (sanitize-version skew): `body_html` is rendered once at write-time
 * and replayed here. If `sanitize_version` is stale relative to the current
 * `SANITIZE_VERSION` we emit a one-line warning so the operator knows the
 * row needs to be swept (an out-of-band script re-renders stale rows). We
 * keep rendering the stored HTML — it was sanitized against whatever
 * allowlist was in force at the time of writing, so it isn't unsafe; it's
 * just potentially out of date.
 */
type Props = {
  html: string
  /**
   * Sanitize-allowlist version under which `html` was last rendered.
   * `undefined` means the caller hasn't been wired through `lib/posts/lookup.ts`
   * yet (W3 owns that file), so the staleness check is skipped.
   */
  sanitizeVersion?: number | null
  postId?: string
}

export function PostBodyStatic({ html, sanitizeVersion, postId }: Props) {
  if (
    sanitizeVersion !== undefined &&
    sanitizeVersion !== null &&
    sanitizeVersion < SANITIZE_VERSION
  ) {
    console.warn(
      `[sanitize_version] stale body_html: post=${postId ?? '?'} stored=${sanitizeVersion} current=${SANITIZE_VERSION} — run the re-sanitize sweep.`,
    )
  }
  return (
    <div className="post-body" dangerouslySetInnerHTML={{ __html: html }} />
  )
}

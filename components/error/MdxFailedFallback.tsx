/**
 * Inline fallback used by <ErrorBoundary /> when a rendered MDX surface
 * (post body, structured section, bio, mermaid diagram) throws on the
 * client. Kept intentionally small and copy-only — no debugging info,
 * no error message — so a malformed widget degrades gracefully without
 * leaking any thrown content.
 */

export interface MdxFailedFallbackProps {
  /** Short surface name used in the user-visible copy (e.g. "post body"). */
  context: string
}

export function MdxFailedFallback({ context }: MdxFailedFallbackProps) {
  return (
    <p className="text-sm text-fg-subtle" role="status">
      Couldn&apos;t render this {context}.
    </p>
  )
}

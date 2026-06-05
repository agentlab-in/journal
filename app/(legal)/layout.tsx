/**
 * Shared chrome for /privacy, /terms, /policy, /grievance, /dmca.
 *
 * The route group only sets up the article container — the per-page
 * <main>, <h1>, last-updated stamp, body, cross-doc nav, and JSON-LD
 * live in the shared LegalPage component (components/legal/LegalPage.tsx).
 * Keeping the markup in a component (not in this layout) lets each page
 * be a clean one-liner that's trivial to inspect for slug correctness.
 */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}

/**
 * RailHeading — the `<h2 class="rail-heading">` used by every right-rail /
 * left-rail discovery section, now with a leading inline SVG icon (issue #65).
 *
 * Why a shared component: the icon + uppercase micro-label markup must stay
 * identical across TopByType and FeaturedTagsFallback so the rails read as
 * one consistent set rather than hand-rolled per-component headers.
 *
 * Icons are SVG-only (no emoji, no icon library) and stroke with
 * `currentColor`, so each one inherits the heading color and flips with the
 * theme automatically. The stroke vocabulary (viewBox 0 0 24 24,
 * strokeWidth 2, round caps) matches the existing lucide-style icons in
 * BookmarkButton / LikeButton — consistency over novelty.
 */
import type { ReactNode } from 'react'

export type RailIconName = 'book-open' | 'compass' | 'tag'

interface RailHeadingProps {
  id: string
  icon: RailIconName
  children: ReactNode
}

export function RailHeading({ id, icon, children }: RailHeadingProps) {
  return (
    <h2 id={id} className="rail-heading">
      <RailIcon name={icon} />
      <span className="rail-heading__label">{children}</span>
    </h2>
  )
}

function RailIcon({ name }: { name: RailIconName }) {
  return (
    <svg
      aria-hidden="true"
      className="rail-heading__icon"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICON_PATHS[name]}
    </svg>
  )
}

// Minimal lucide-style stroke paths. Kept here (not inlined per call site)
// so the four rail icons share one source of truth.
const ICON_PATHS: Record<RailIconName, ReactNode> = {
  // book-open → Top playbooks
  'book-open': (
    <>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </>
  ),
  // compass → Top deep dives
  compass: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </>
  ),
  // tag → Featured / starter topics
  tag: (
    <>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </>
  ),
}

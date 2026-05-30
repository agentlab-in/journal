/**
 * Skeleton primitives — small set of presentational building blocks used
 * to compose domain-specific placeholders (PostCardSkeleton,
 * CommentSkeleton, etc.).
 *
 * Design choices:
 * - Animation: Tailwind's built-in `animate-pulse`. We considered a
 *   shimmer-wave (gradient sweep) but pulse is cheaper, respects
 *   `prefers-reduced-motion` automatically via Tailwind 4, and matches
 *   what the codebase already uses in `NavAuth` for the loading badge.
 *   See discussion #23 for the rationale.
 * - Colors: `bg-bg-subtle` (theme token). No hardcoded greys — this is
 *   enforced project-wide.
 * - Accessibility: each primitive is `aria-hidden="true"` because it is
 *   purely decorative. The caller (composite skeleton) is responsible
 *   for wrapping the group in `role="status"` + `aria-label="Loading…"`
 *   so screen readers announce ONE "Loading" message per region instead
 *   of enumerating every bar/circle.
 *
 * These are server-component-safe (no `'use client'`, no hooks).
 */

import type { CSSProperties } from 'react'

export interface SkeletonTextProps {
  /** Extra Tailwind classes. Default width is `w-full`; override via className. */
  className?: string
}

/**
 * Horizontal pulsing bar sized to one line of text. Height matches the
 * default `text-base` line so it can sit inline with real text without
 * shifting layout.
 */
export function SkeletonText({ className = '' }: SkeletonTextProps) {
  return (
    <span
      aria-hidden="true"
      className={`block h-4 w-full animate-pulse rounded bg-bg-subtle ${className}`}
    />
  )
}

export interface SkeletonCircleProps {
  /** Diameter in px. Defaults to 32 to match feed avatars. */
  size?: number
  className?: string
}

/**
 * Round pulsing placeholder for avatars. Sized via inline style so the
 * caller doesn't have to remember `h-X w-X` pairs and so arbitrary pixel
 * values work without Tailwind JIT.
 */
export function SkeletonCircle({ size = 32, className = '' }: SkeletonCircleProps) {
  const style: CSSProperties = { width: size, height: size }
  return (
    <span
      aria-hidden="true"
      style={style}
      className={`inline-block animate-pulse rounded-full bg-bg-subtle ${className}`}
    />
  )
}

export interface SkeletonBlockProps {
  /**
   * Tailwind classes for sizing (e.g. `h-40 w-full`). Defaults to a
   * generic small block — callers should usually override.
   */
  className?: string
}

/**
 * Rectangular pulsing block. Used for cover-image-shaped placeholders
 * and large content rectangles. Sizing is delegated to the caller via
 * `className` so we don't have to invent a prop matrix.
 */
export function SkeletonBlock({ className = '' }: SkeletonBlockProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-bg-subtle ${className}`}
    />
  )
}

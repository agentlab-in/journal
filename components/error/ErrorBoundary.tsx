'use client'

/**
 * <ErrorBoundary />
 *
 * Minimal class-based React error boundary used for narrow, widget-level
 * recovery — Mermaid diagrams, MDX bodies, bio rendering, structured
 * sections. The Next.js route-level `error.tsx` files catch anything
 * that escapes; this primitive exists so a single broken widget doesn't
 * take down the surrounding page.
 *
 * Why a class component: React 19 still has no built-in error boundary
 * hook. The class API (`getDerivedStateFromError` + `componentDidCatch`)
 * is ~30 lines and avoids pulling in a dep for it.
 *
 * `resetKey` lets a parent recover the boundary without a full page
 * reload — when the value changes between renders, the boundary's
 * internal `hasError` flips back to false and the children re-mount.
 * Useful when the failing input (e.g. an MDX string) is replaced.
 *
 * IMPORTANT: never render `error.message` / `error.stack` from the
 * caught error here. Production server errors are scrubbed by Next.js,
 * but a client-thrown error could include user-controlled text — keep
 * the surface to the static `fallback` node only.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface ErrorBoundaryProps {
  /** Rendered in place of `children` when a render error is caught. */
  fallback: ReactNode
  /**
   * Optional reset signal — when this value changes between renders,
   * the boundary clears its error state and re-mounts `children`.
   */
  resetKey?: unknown
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Error tracking (Sentry etc.) is out of scope for v1 — log to the
    // browser console so devs see the throw in DevTools. `info` carries
    // the React component stack for easier triage.
    console.error('ErrorBoundary caught:', error, info)
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false })
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

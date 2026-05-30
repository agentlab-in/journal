/**
 * ErrorBoundary primitive — behavioural contract.
 *
 * Three guarantees pinned here:
 *   1. Normal render path is transparent: when children don't throw,
 *      we see the children.
 *   2. When a child throws during render, the fallback is rendered
 *      instead. Caught error is logged via `console.error`, which we
 *      stub to keep test output clean.
 *   3. `resetKey` recovery: after a throw, if the parent re-renders
 *      with a different `resetKey` AND non-throwing children, the
 *      boundary clears its error state and the fresh children mount.
 *
 * React intentionally logs the caught error twice in dev (the boundary
 * call + React's own logger). We silence console.error for the
 * throw-path tests so failures are signal, not noise.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ErrorBoundary } from '@/components/error/ErrorBoundary'

function Bomb({ shouldThrow }: { shouldThrow: boolean }): React.ReactElement {
  if (shouldThrow) {
    throw new Error('boom')
  }
  return <span>safe</span>
}

describe('<ErrorBoundary />', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('renders children when no error is thrown', () => {
    render(
      <ErrorBoundary fallback={<p>fallback</p>}>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('safe')).toBeInTheDocument()
    expect(screen.queryByText('fallback')).toBeNull()
  })

  it('renders fallback when a child throws', () => {
    render(
      <ErrorBoundary fallback={<p>fallback</p>}>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('fallback')).toBeInTheDocument()
    expect(screen.queryByText('safe')).toBeNull()
  })

  it('resets error state when resetKey changes', () => {
    // First render: throws, fallback shown.
    const { rerender } = render(
      <ErrorBoundary fallback={<p>fallback</p>} resetKey="v1">
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('fallback')).toBeInTheDocument()

    // Parent re-renders with a different resetKey AND non-throwing
    // children. Boundary should flip hasError back to false and mount
    // the fresh children.
    rerender(
      <ErrorBoundary fallback={<p>fallback</p>} resetKey="v2">
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('safe')).toBeInTheDocument()
    expect(screen.queryByText('fallback')).toBeNull()
  })

  it('does NOT reset when resetKey stays the same', () => {
    const { rerender } = render(
      <ErrorBoundary fallback={<p>fallback</p>} resetKey="v1">
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('fallback')).toBeInTheDocument()

    // Same resetKey + non-throwing children: boundary still in error
    // state, fallback stays — the parent hasn't signalled recovery.
    rerender(
      <ErrorBoundary fallback={<p>fallback</p>} resetKey="v1">
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('fallback')).toBeInTheDocument()
  })

  it('logs caught errors via console.error', () => {
    render(
      <ErrorBoundary fallback={<p>fallback</p>}>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    )
    // console.error gets called multiple times (React's own logger
    // + our componentDidCatch). The "ErrorBoundary caught:" prefix is
    // ours and confirms the boundary saw the throw.
    const calls = (errorSpy.mock.calls as unknown[][]).flat().map((arg) => String(arg))
    expect(calls.some((c: string) => c.includes('ErrorBoundary caught:'))).toBe(true)
  })
})

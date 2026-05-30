/**
 * Route-level error.tsx fallbacks — smoke test.
 *
 * We pin one representative segment fallback (the post-page one) to
 * confirm the canonical shape: heading + try-again button that calls
 * `reset` + home link. The other five route fallbacks are structural
 * clones with different copy; typecheck + lint cover their JSX shape.
 *
 * Critical no-leak contract: never render `error.message` /
 * `error.stack` in the fallback JSX. The test passes a sentinel
 * message ("super-secret-stack") and confirms it is NOT present in
 * the rendered output.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import PostError from '@/app/[username]/[type]/[slug]/error'

describe('post-page route-level error.tsx', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // useEffect logs the error — silence it so the test output stays clean.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('renders the friendly title + retry button + home link', () => {
    const reset = vi.fn()
    const err = Object.assign(new Error('super-secret-stack'), {
      digest: 'abc123',
    })

    render(<PostError error={err} reset={reset} />)

    expect(
      screen.getByRole('heading', { name: /couldn.?t load this post/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /try again/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /back to agentlab/i }),
    ).toBeInTheDocument()
  })

  it('does NOT leak the raw error message into the JSX', () => {
    const reset = vi.fn()
    const err = Object.assign(new Error('super-secret-stack'), {
      digest: 'abc123',
    })

    const { container } = render(<PostError error={err} reset={reset} />)

    // The friendly copy is rendered; the original Error.message is NOT.
    expect(container.textContent ?? '').not.toContain('super-secret-stack')
  })

  it('invokes reset() when try again is clicked', () => {
    const reset = vi.fn()
    const err = Object.assign(new Error('boom'), { digest: 'xyz' })

    render(<PostError error={err} reset={reset} />)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('home link points at /', () => {
    const reset = vi.fn()
    const err = Object.assign(new Error('boom'), { digest: 'xyz' })

    render(<PostError error={err} reset={reset} />)
    const link = screen.getByRole('link', { name: /back to agentlab/i })
    expect(link.getAttribute('href')).toBe('/')
  })
})

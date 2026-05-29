import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AuthorActions } from '@/components/posts/AuthorActions'

const POST_ID = 'post-abc-123'

// Mock next/link so it renders a plain anchor in jsdom
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.stubGlobal('confirm', vi.fn())
  vi.stubGlobal('alert', vi.fn())
  // location.assign is tricky in jsdom; stub it directly
  Object.defineProperty(window, 'location', {
    value: { assign: vi.fn() },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthorActions', () => {
  it('does NOT call fetch or navigate when user cancels confirm', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)

    render(<AuthorActions postId={POST_ID} />)
    const deleteBtn = screen.getByRole('button', { name: /delete/i })
    fireEvent.click(deleteBtn)

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith(
        'Delete this post? This cannot be undone.',
      )
    })

    expect(fetch).not.toHaveBeenCalled()
    expect(window.location.assign).not.toHaveBeenCalled()
  })

  it('calls DELETE, then navigates to "/" when fetch resolves ok', async () => {
    vi.mocked(window.confirm).mockReturnValue(true)
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)

    render(<AuthorActions postId={POST_ID} />)
    const deleteBtn = screen.getByRole('button', { name: /delete/i })
    fireEvent.click(deleteBtn)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `/api/posts/${POST_ID}`,
        expect.objectContaining({ method: 'DELETE' }),
      )
    })

    await waitFor(() => {
      expect(window.location.assign).toHaveBeenCalledWith('/')
    })

    expect(window.alert).not.toHaveBeenCalled()
  })

  it('shows alert and does NOT navigate when fetch resolves !ok', async () => {
    vi.mocked(window.confirm).mockReturnValue(true)
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response)

    render(<AuthorActions postId={POST_ID} />)
    const deleteBtn = screen.getByRole('button', { name: /delete/i })
    fireEvent.click(deleteBtn)

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Delete failed.')
    })

    expect(window.location.assign).not.toHaveBeenCalled()
  })
})

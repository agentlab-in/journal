import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { ViewBeacon } from '@/components/posts/ViewBeacon'

// jsdom localStorage is available but we spy on it for clarity
const POST_ID = 'test-post-123'
const LS_KEY = `agentlab.viewed.${POST_ID}`

// Mock Next.js navigation (needed by any indirect imports)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ViewBeacon', () => {
  it('fires POST /api/posts/<id>/view and writes localStorage on first mount (no entry)', async () => {
    expect(localStorage.getItem(LS_KEY)).toBeNull()
    render(<ViewBeacon postId={POST_ID} />)

    // Wait for the microtask / effect to flush
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `/api/posts/${POST_ID}/view`,
        expect.objectContaining({ method: 'POST', keepalive: true }),
      )
    })

    const stored = localStorage.getItem(LS_KEY)
    expect(stored).not.toBeNull()
    expect(() => new Date(stored!)).not.toThrow()
  })

  it('does NOT fire fetch when localStorage entry is within 24h', async () => {
    // Set a timestamp 1 hour ago
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    localStorage.setItem(LS_KEY, oneHourAgo)

    render(<ViewBeacon postId={POST_ID} />)

    // Give effects time to run
    await new Promise((r) => setTimeout(r, 50))

    expect(fetch).not.toHaveBeenCalled()
  })

  it('fires fetch when localStorage entry is older than 24h', async () => {
    // Set a timestamp 25 hours ago
    const twentyFiveHoursAgo = new Date(
      Date.now() - 25 * 60 * 60 * 1000,
    ).toISOString()
    localStorage.setItem(LS_KEY, twentyFiveHoursAgo)

    render(<ViewBeacon postId={POST_ID} />)

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `/api/posts/${POST_ID}/view`,
        expect.objectContaining({ method: 'POST', keepalive: true }),
      )
    })

    // Also updates localStorage
    const stored = localStorage.getItem(LS_KEY)
    expect(stored).not.toBe(twentyFiveHoursAgo)
  })
})

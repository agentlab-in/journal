/**
 * <RightSidebar /> unit tests.
 *
 * Strategy: mock @/lib/feed/discovery-cache (and child components that
 * are themselves async). Verify the bothEmpty fallback logic.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TopPostRow } from '@/lib/feed/top-by-type'

// ---------------------------------------------------------------------------
// Mocks — must be declared before component imports.
// ---------------------------------------------------------------------------

vi.mock('@/lib/feed/discovery-cache', () => ({
  cachedTopPlaybooks: vi.fn(),
  cachedTopDives: vi.fn(),
}))

// Stub child async components with synchronous stubs so RightSidebar
// can be rendered in jsdom without needing Suspense streaming.
vi.mock('@/components/home/TopByType', () => ({
  TopByType: async ({ type }: { type: string }) =>
    React.createElement('div', { 'data-testid': `top-by-type-${type}` }),
}))

vi.mock('@/components/home/FeaturedTagsFallback', () => ({
  FeaturedTagsFallback: () =>
    React.createElement('div', { 'data-testid': 'featured-tags-fallback' }),
}))

vi.mock('@/components/skeleton/RailSkeleton', () => ({
  RailSkeleton: ({ rows }: { rows?: number }) =>
    React.createElement('div', { 'data-testid': `rail-skeleton-${rows ?? 3}` }),
}))

import { cachedTopPlaybooks, cachedTopDives } from '@/lib/feed/discovery-cache'
import { RightSidebar } from '@/components/home/RightSidebar'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_POST: TopPostRow = {
  id: 'p1',
  slug: 'my-post',
  title: 'My Post',
  type: 'playbook',
  leading_segment: 'alice',
  author_username: 'alice',
  author_display_name: 'Alice',
  like_count: 5,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('<RightSidebar>', () => {
  beforeEach(() => {
    vi.mocked(cachedTopPlaybooks).mockReset()
    vi.mocked(cachedTopDives).mockReset()
  })

  it('renders FeaturedTagsFallback ONLY when both playbooks and dives are empty', async () => {
    vi.mocked(cachedTopPlaybooks).mockResolvedValue([])
    vi.mocked(cachedTopDives).mockResolvedValue([])

    const element = await RightSidebar()
    render(element as React.ReactElement)

    expect(screen.getByTestId('featured-tags-fallback')).toBeInTheDocument()
  })

  it('does NOT render FeaturedTagsFallback when playbooks are present', async () => {
    vi.mocked(cachedTopPlaybooks).mockResolvedValue([SAMPLE_POST])
    vi.mocked(cachedTopDives).mockResolvedValue([])

    const element = await RightSidebar()
    render(element as React.ReactElement)

    expect(screen.queryByTestId('featured-tags-fallback')).not.toBeInTheDocument()
  })

  it('does NOT render FeaturedTagsFallback when dives are present', async () => {
    vi.mocked(cachedTopPlaybooks).mockResolvedValue([])
    vi.mocked(cachedTopDives).mockResolvedValue([{ ...SAMPLE_POST, type: 'dive' }])

    const element = await RightSidebar()
    render(element as React.ReactElement)

    expect(screen.queryByTestId('featured-tags-fallback')).not.toBeInTheDocument()
  })

  it('does NOT render FeaturedTagsFallback when both are present', async () => {
    vi.mocked(cachedTopPlaybooks).mockResolvedValue([SAMPLE_POST])
    vi.mocked(cachedTopDives).mockResolvedValue([{ ...SAMPLE_POST, type: 'dive' }])

    const element = await RightSidebar()
    render(element as React.ReactElement)

    expect(screen.queryByTestId('featured-tags-fallback')).not.toBeInTheDocument()
  })
})

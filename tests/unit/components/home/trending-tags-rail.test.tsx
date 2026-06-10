/**
 * <TrendingTagsRail /> unit tests.
 *
 * Strategy: mock @/lib/feed/discovery-cache so the component never
 * touches unstable_cache or the DB. Await the async server component
 * function, then render the returned element with @testing-library/react.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TrendingTag } from '@/lib/feed/trending-tags'

// ---------------------------------------------------------------------------
// Mock the discovery-cache module BEFORE importing the component.
// ---------------------------------------------------------------------------
vi.mock('@/lib/feed/discovery-cache', () => ({
  cachedTrendingTags: vi.fn(),
  cachedTopPlaybooks: vi.fn(),
  cachedTopDives: vi.fn(),
}))

// Mock next/link to a plain <a> so we can assert hrefs.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}))

import { cachedTrendingTags } from '@/lib/feed/discovery-cache'
import { TrendingTagsRail } from '@/components/home/TrendingTagsRail'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('<TrendingTagsRail>', () => {
  beforeEach(() => {
    vi.mocked(cachedTrendingTags).mockReset()
  })

  it('returns null (renders nothing) when tags array is empty', async () => {
    vi.mocked(cachedTrendingTags).mockResolvedValue([])
    const element = await TrendingTagsRail()
    expect(element).toBeNull()
  })

  it('renders one Link per tag with count', async () => {
    const tags: TrendingTag[] = [
      { slug: 'memory', name: 'Memory', count: 5 },
      { slug: 'evals', name: 'Evals', count: 3 },
    ]
    vi.mocked(cachedTrendingTags).mockResolvedValue(tags)

    const element = await TrendingTagsRail()
    render(element as React.ReactElement)

    // Heading must be present.
    expect(screen.getByRole('heading', { name: 'Trending tags' })).toBeInTheDocument()

    // One link per tag.
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)

    // Links should go to /tag/<slug>.
    expect(links[0]).toHaveAttribute('href', '/tag/memory')
    expect(links[1]).toHaveAttribute('href', '/tag/evals')

    // Tag names and counts are rendered.
    expect(screen.getByText('#Memory')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('#Evals')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('uses the default headingId "trending-tags-heading" when no prop is passed', async () => {
    vi.mocked(cachedTrendingTags).mockResolvedValue([
      { slug: 'memory', name: 'Memory', count: 1 },
    ])
    const element = await TrendingTagsRail()
    render(element as React.ReactElement)
    expect(screen.getByRole('heading', { name: 'Trending tags' })).toHaveAttribute(
      'id',
      'trending-tags-heading',
    )
  })

  it('uses the provided headingId override (duplicate-id-aria fix)', async () => {
    vi.mocked(cachedTrendingTags).mockResolvedValue([
      { slug: 'evals', name: 'Evals', count: 2 },
    ])
    const element = await TrendingTagsRail({ headingId: 'trending-tags-heading-lg' })
    render(element as React.ReactElement)
    expect(screen.getByRole('heading', { name: 'Trending tags' })).toHaveAttribute(
      'id',
      'trending-tags-heading-lg',
    )
  })
})

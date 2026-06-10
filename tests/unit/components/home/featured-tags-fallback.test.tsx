/**
 * <FeaturedTagsFallback /> unit tests.
 *
 * Verifies that all 8 starter tags from FEATURED_TAG_SLUGS are rendered
 * as links. The count is imported from the real constant so this test
 * auto-updates if the list changes.
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock next/link to a plain <a> for assertion.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}))

import { FeaturedTagsFallback } from '@/components/home/FeaturedTagsFallback'
import { FEATURED_TAG_SLUGS } from '@/lib/search/featured-tags'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('<FeaturedTagsFallback>', () => {
  it(`renders exactly ${FEATURED_TAG_SLUGS.length} tag links (all FEATURED_TAG_SLUGS)`, () => {
    render(React.createElement(FeaturedTagsFallback))

    const links = screen.getAllByRole('link')
    // One link per featured tag.
    expect(links).toHaveLength(FEATURED_TAG_SLUGS.length)
  })

  it('renders a link for each slug in FEATURED_TAG_SLUGS with correct href', () => {
    render(React.createElement(FeaturedTagsFallback))

    for (const slug of FEATURED_TAG_SLUGS) {
      const link = screen.getByRole('link', { name: `#${slug}` })
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', `/tag/${slug}`)
    }
  })

  it('renders the "Starter topics" heading', () => {
    render(React.createElement(FeaturedTagsFallback))
    expect(screen.getByRole('heading', { name: 'Starter topics' })).toBeInTheDocument()
  })
})

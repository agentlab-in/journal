/**
 * <TopByType /> unit tests.
 *
 * Strategy: mock @/lib/feed/discovery-cache so the component never touches
 * unstable_cache or the DB. Await the async server component function and
 * render the returned element with @testing-library/react.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TopPostRow } from '@/lib/feed/top-by-type'

// ---------------------------------------------------------------------------
// Mocks — must be declared before component import.
// ---------------------------------------------------------------------------
vi.mock('@/lib/feed/discovery-cache', () => ({
  cachedTrendingTags: vi.fn(),
  cachedTopPlaybooks: vi.fn(),
  cachedTopDives: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}))

import { cachedTopPlaybooks, cachedTopDives } from '@/lib/feed/discovery-cache'
import { TopByType } from '@/components/home/TopByType'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLAYBOOK_ROW: TopPostRow = {
  id: 'p1',
  slug: 'agent-memory-guide',
  title: 'Agent Memory Guide',
  type: 'playbook',
  leading_segment: 'alice',
  author_username: 'alice',
  author_display_name: 'Alice',
  like_count: 12,
}

const DIVE_ROW: TopPostRow = {
  id: 'd1',
  slug: 'context-windows-deep',
  title: 'Context Windows Deep',
  type: 'dive',
  leading_segment: 'bob',
  author_username: 'bob',
  author_display_name: 'Bob',
  like_count: 7,
}

const ORG_PLAYBOOK_ROW: TopPostRow = {
  id: 'p2',
  slug: 'org-published',
  title: 'Org Published Playbook',
  type: 'playbook',
  leading_segment: 'acme-org',  // org slug
  author_username: 'carol',
  author_display_name: 'Carol',
  like_count: 4,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('<TopByType type="playbook">', () => {
  beforeEach(() => {
    vi.mocked(cachedTopPlaybooks).mockReset()
    vi.mocked(cachedTopDives).mockReset()
  })

  it('returns null when playbooks array is empty', async () => {
    vi.mocked(cachedTopPlaybooks).mockResolvedValue([])
    const element = await TopByType({ type: 'playbook' })
    expect(element).toBeNull()
  })

  it('uses cachedTopPlaybooks for type=playbook (not cachedTopDives)', async () => {
    vi.mocked(cachedTopPlaybooks).mockResolvedValue([PLAYBOOK_ROW])
    vi.mocked(cachedTopDives).mockResolvedValue([])

    await TopByType({ type: 'playbook' })

    expect(cachedTopPlaybooks).toHaveBeenCalledTimes(1)
    expect(cachedTopDives).not.toHaveBeenCalled()
  })

  it('uses cachedTopDives for type=dive (not cachedTopPlaybooks)', async () => {
    vi.mocked(cachedTopDives).mockResolvedValue([DIVE_ROW])
    vi.mocked(cachedTopPlaybooks).mockResolvedValue([])

    await TopByType({ type: 'dive' })

    expect(cachedTopDives).toHaveBeenCalledTimes(1)
    expect(cachedTopPlaybooks).not.toHaveBeenCalled()
  })

  it('renders heading "Top playbooks this week" for type=playbook', async () => {
    vi.mocked(cachedTopPlaybooks).mockResolvedValue([PLAYBOOK_ROW])
    const element = await TopByType({ type: 'playbook' })
    render(element as React.ReactElement)
    expect(screen.getByRole('heading', { name: 'Top playbooks this week' })).toBeInTheDocument()
  })

  it('renders heading "Top deep dives this week" for type=dive', async () => {
    vi.mocked(cachedTopDives).mockResolvedValue([DIVE_ROW])
    const element = await TopByType({ type: 'dive' })
    render(element as React.ReactElement)
    expect(screen.getByRole('heading', { name: 'Top deep dives this week' })).toBeInTheDocument()
  })

  it('renders title, author username, and like count for each row', async () => {
    vi.mocked(cachedTopPlaybooks).mockResolvedValue([PLAYBOOK_ROW])
    const element = await TopByType({ type: 'playbook' })
    render(element as React.ReactElement)

    expect(screen.getByText('Agent Memory Guide')).toBeInTheDocument()
    expect(screen.getByText(/@alice/)).toBeInTheDocument()
    expect(screen.getByText(/12/)).toBeInTheDocument()
  })

  it('builds href with postUrl using leading_segment (personal post → author username)', async () => {
    vi.mocked(cachedTopPlaybooks).mockResolvedValue([PLAYBOOK_ROW])
    const element = await TopByType({ type: 'playbook' })
    render(element as React.ReactElement)

    // postUrl('alice', 'playbook', 'agent-memory-guide') → /alice/playbook/agent-memory-guide
    const link = screen.getByRole('link', { name: /Agent Memory Guide/ })
    expect(link).toHaveAttribute('href', '/alice/playbook/agent-memory-guide')
  })

  it('builds href using org slug as leading_segment for org posts', async () => {
    vi.mocked(cachedTopPlaybooks).mockResolvedValue([ORG_PLAYBOOK_ROW])
    const element = await TopByType({ type: 'playbook' })
    render(element as React.ReactElement)

    // postUrl('acme-org', 'playbook', 'org-published') → /acme-org/playbook/org-published
    const link = screen.getByRole('link', { name: /Org Published Playbook/ })
    expect(link).toHaveAttribute('href', '/acme-org/playbook/org-published')
  })

  it('uses the default headingId "top-playbook-heading" when no headingId prop', async () => {
    vi.mocked(cachedTopPlaybooks).mockResolvedValue([PLAYBOOK_ROW])
    const element = await TopByType({ type: 'playbook' })
    render(element as React.ReactElement)
    expect(screen.getByRole('heading', { name: 'Top playbooks this week' })).toHaveAttribute(
      'id',
      'top-playbook-heading',
    )
  })

  it('uses the provided headingId override (duplicate-id-aria fix)', async () => {
    vi.mocked(cachedTopPlaybooks).mockResolvedValue([PLAYBOOK_ROW])
    const element = await TopByType({ type: 'playbook', headingId: 'top-playbook-heading-mobile' })
    render(element as React.ReactElement)
    expect(screen.getByRole('heading', { name: 'Top playbooks this week' })).toHaveAttribute(
      'id',
      'top-playbook-heading-mobile',
    )
  })
})

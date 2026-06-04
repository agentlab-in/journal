/**
 * Phase 11.5 — Editor + settings + nav UI tests.
 *
 * Covers:
 *  1. PublishAsSelect: hides when no orgs (new mode).
 *  2. PublishAsSelect: renders dropdown with personal + each org (new mode).
 *  3. PublishAsSelect: edit mode renders disabled with current selection.
 *  4. PostCard: org byline renders "{org} via @{author}".
 *  5. OrgsListSection: read-only — empty-state copy + rows + View link only.
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Single shared router mock for the whole file. PublishAsSelect doesn't use
// it, but other components imported by the editor tree may; keep the mock
// in place so importing this file is side-effect-safe across runs.
const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

import {
  PublishAsSelect,
  type PublishAsOrgOption,
} from '@/components/editor/PublishAsSelect'
import { OrgsListSection } from '@/components/settings/OrgsListSection'
import { PostCard, type PostCardData } from '@/components/post/PostCard'

// ---------------------------------------------------------------------------
// PublishAsSelect
// ---------------------------------------------------------------------------

describe('<PublishAsSelect>', () => {
  it('renders nothing when userOrgs is empty in new mode', () => {
    const { container } = render(
      <PublishAsSelect
        currentUsername="alice"
        userOrgs={[]}
        value={null}
        onChange={() => {}}
        mode="new"
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders a dropdown with personal + each org option in new mode', () => {
    const orgs: PublishAsOrgOption[] = [
      { id: 'org-1', slug: 'acme', display_name: 'Acme Research' },
      { id: 'org-2', slug: 'globex', display_name: 'Globex' },
    ]
    render(
      <PublishAsSelect
        currentUsername="alice"
        userOrgs={orgs}
        value={null}
        onChange={() => {}}
        mode="new"
      />,
    )
    const select = screen.getByLabelText(/publish as/i) as HTMLSelectElement
    expect(select).toBeDefined()
    const options = Array.from(select.querySelectorAll('option'))
    expect(options).toHaveLength(3)
    expect(options[0].textContent).toBe('@alice')
    expect(options[1].textContent).toBe('Acme Research (@acme)')
    expect(options[1].value).toBe('org-1')
    expect(options[2].value).toBe('org-2')
  })

  it('edit mode renders disabled with current org_id selected', () => {
    const orgs: PublishAsOrgOption[] = [
      { id: 'org-1', slug: 'acme', display_name: 'Acme Research' },
    ]
    render(
      <PublishAsSelect
        currentUsername="alice"
        userOrgs={orgs}
        value="org-1"
        onChange={() => {}}
        mode="edit"
        disabled
      />,
    )
    const select = screen.getByLabelText(/publish as/i) as HTMLSelectElement
    expect(select.disabled).toBe(true)
    expect(select.value).toBe('org-1')
  })
})

// ---------------------------------------------------------------------------
// PostCard byline
// ---------------------------------------------------------------------------

describe('<PostCard> byline', () => {
  const base: PostCardData = {
    id: 'p1',
    type: 'post',
    slug: 'hello',
    title: 'Hello',
    summary: 'A summary',
    published_at: '2026-06-01T00:00:00Z',
    like_count: 0,
    bookmark_count: 0,
    comment_count: 0,
    author: {
      username: 'alice',
      display_name: 'Alice',
      avatar_url: null,
    },
    tags: [],
  }

  it('renders the personal byline when no org is set', () => {
    render(<PostCard post={base} />)
    expect(screen.getByText('Alice')).toBeDefined()
    expect(screen.getByText('@alice')).toBeDefined()
    // No "via" prefix in the personal byline.
    expect(screen.queryByText(/via/i)).toBeNull()
  })

  it('renders "{org} via @{author}" when org is set', () => {
    render(
      <PostCard
        post={{
          ...base,
          org: { slug: 'acme', display_name: 'Acme Research' },
        }}
      />,
    )
    expect(screen.getByText('Acme Research')).toBeDefined()
    expect(screen.getByText('@alice')).toBeDefined()
    expect(screen.getByText(/via/i)).toBeDefined()
    // The card link uses the org slug as the leading URL segment.
    const titleLink = screen
      .getByRole('heading', { level: 2 })
      .querySelector('a')!
    expect(titleLink.getAttribute('href')).toBe('/acme/post/hello')
  })
})

// ---------------------------------------------------------------------------
// OrgsListSection (read-only)
// ---------------------------------------------------------------------------

describe('<OrgsListSection>', () => {
  it('renders the read-only empty-state copy when the caller has no orgs', () => {
    render(<OrgsListSection orgs={[]} />)
    expect(
      screen.getByText(
        /you’re not in any orgs yet\. join a github org and sign back in/i,
      ),
    ).toBeDefined()
    // No /settings/orgs/new CTA — that surface no longer exists.
    expect(
      screen.queryByRole('link', { name: /create your first org/i }),
    ).toBeNull()
    expect(
      screen.queryByRole('link', { name: /create another org/i }),
    ).toBeNull()
  })

  it('renders each org as a row with display_name, slug, and a View link to /<slug>', () => {
    render(
      <OrgsListSection
        orgs={[
          { id: 'org-1', slug: 'acme', display_name: 'Acme' },
          { id: 'org-2', slug: 'globex', display_name: 'Globex' },
        ]}
      />,
    )

    expect(screen.getByText('Acme')).toBeDefined()
    expect(screen.getByText('Globex')).toBeDefined()
    expect(screen.getByText('@acme')).toBeDefined()
    expect(screen.getByText('@globex')).toBeDefined()

    const viewLinks = screen.getAllByRole('link', { name: /view/i })
    expect(viewLinks).toHaveLength(2)
    expect(viewLinks[0].getAttribute('href')).toBe('/acme')
    expect(viewLinks[1].getAttribute('href')).toBe('/globex')
  })

  it('does not render Leave buttons or Manage links', () => {
    render(
      <OrgsListSection
        orgs={[{ id: 'org-1', slug: 'acme', display_name: 'Acme' }]}
      />,
    )
    expect(screen.queryByRole('button', { name: /leave/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /manage/i })).toBeNull()
  })
})

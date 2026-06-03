/**
 * Phase 11 / T5 — Editor + settings + nav UI tests.
 *
 * Covers:
 *  1. PublishAsSelect: hides when no orgs (new mode).
 *  2. PublishAsSelect: renders dropdown with personal + each org (new mode).
 *  3. PublishAsSelect: edit mode renders disabled with current selection.
 *  4. OrgCreateForm: POSTs /api/orgs and redirects on success.
 *  5. OrgMembersPanel: 409 last_admin surfaces inline.
 *  6. PostCard: org byline renders "{org} via @{author}".
 *  7. OrgsListSection: empty state nudges to create; renders rows.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Single shared router mock for the whole file. Tests reset it in beforeEach.
const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

import {
  PublishAsSelect,
  type PublishAsOrgOption,
} from '@/components/editor/PublishAsSelect'
import { OrgCreateForm } from '@/components/settings/OrgCreateForm'
import {
  OrgMembersPanel,
  type OrgMember,
} from '@/components/settings/orgs/OrgMembersPanel'
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
// OrgCreateForm
// ---------------------------------------------------------------------------

describe('<OrgCreateForm>', () => {
  beforeEach(() => {
    mockPush.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('submits POST /api/orgs and redirects to /settings/orgs/[slug]', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'org-1', slug: 'acme', display_name: 'Acme' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<OrgCreateForm />)
    fireEvent.change(screen.getByLabelText(/slug/i), {
      target: { value: 'acme' },
    })
    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: 'Acme' },
    })
    const form = document.querySelector('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/orgs',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/settings/orgs/acme'),
    )
  })

  it('surfaces slug_taken errors inline', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'slug_taken', reason: 'reserved' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<OrgCreateForm />)
    fireEvent.change(screen.getByLabelText(/slug/i), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: 'Admin Co' },
    })
    fireEvent.submit(document.querySelector('form')!)

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/already in use/i),
    )
    expect(mockPush).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// OrgMembersPanel
// ---------------------------------------------------------------------------

describe('<OrgMembersPanel>', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockRefresh.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const sampleMembers: OrgMember[] = [
    {
      user_id: 'me',
      username: 'alice',
      display_name: 'Alice',
      avatar_url: null,
      role: 'admin',
    },
    {
      user_id: 'bob',
      username: 'bob',
      display_name: 'Bob',
      avatar_url: null,
      role: 'member',
    },
  ]

  it('renders an inline error when a role change returns last_admin (409)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'last_admin' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <OrgMembersPanel
        slug="acme"
        callerUserId="me"
        initialMembers={sampleMembers}
      />,
    )

    const select = screen.getByLabelText(/role for @alice/i) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'member' } })

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/last admin/i),
    )
  })

  it('renders an inline error when self-leave hits last_admin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'last_admin' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <OrgMembersPanel
        slug="acme"
        callerUserId="me"
        initialMembers={sampleMembers}
      />,
    )

    const aliceRow = screen.getByTestId('org-member-alice')
    const leaveBtn = aliceRow.querySelector('button')!
    fireEvent.click(leaveBtn)

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/last admin/i),
    )
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
// OrgsListSection
// ---------------------------------------------------------------------------

describe('<OrgsListSection>', () => {
  it('renders an empty-state CTA when the caller has no orgs', () => {
    render(<OrgsListSection callerUserId="me" orgs={[]} />)
    const link = screen.getByRole('link', { name: /create your first org/i })
    expect(link.getAttribute('href')).toBe('/settings/orgs/new')
  })

  it('renders each org with role + Manage link for admin rows', () => {
    render(
      <OrgsListSection
        callerUserId="me"
        orgs={[
          {
            id: 'org-1',
            slug: 'acme',
            display_name: 'Acme',
            role: 'admin',
          },
          {
            id: 'org-2',
            slug: 'globex',
            display_name: 'Globex',
            role: 'member',
          },
        ]}
      />,
    )
    expect(screen.getByText('Acme')).toBeDefined()
    expect(screen.getByText('Globex')).toBeDefined()
    const manage = screen.getByRole('link', { name: /manage/i })
    expect(manage.getAttribute('href')).toBe('/settings/orgs/acme')
    // Globex (member) has no Manage link — only Acme should.
    expect(screen.getAllByRole('link', { name: /manage/i })).toHaveLength(1)
  })
})

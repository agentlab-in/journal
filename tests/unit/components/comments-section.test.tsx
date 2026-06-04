/**
 * CommentsSection server-component tests.
 *
 * Server components return a React tree synchronously after their async
 * work, so we await the call and then mount the result with React Testing
 * Library to inspect the DOM. The Supabase admin client is replaced with a
 * vi.fn that returns a chainable stub matching the
 *   admin.from(...).select(...).eq(...).order(...).limit(...)
 * shape used by CommentsSection.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}))

const sessionState: { value: { user?: { id: string } } | null } = { value: null }
const adminState: { value: boolean } = { value: false }

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => sessionState.value),
  resolveIsAdmin: vi.fn(async () => adminState.value),
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => React.createElement('a', { href, className }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/test-post',
}))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { CommentsSection } from '@/components/post/CommentsSection'

interface RawCommentRow {
  id: string
  post_id: string
  parent_comment_id: string | null
  body: string
  author_id: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  deletion_reason: 'author' | 'moderation' | null
  users: { username: string; display_name: string; avatar_url: string | null } | null
}

function fakeAdmin(rows: RawCommentRow[] | null, error: unknown = null) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(() => Promise.resolve({ data: rows, error })),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  return { from: vi.fn(() => chain) }
}

function comment(overrides: Partial<RawCommentRow>): RawCommentRow {
  return {
    id: 'cid',
    post_id: 'post-1',
    parent_comment_id: null,
    body: 'hello',
    author_id: 'user-x',
    created_at: '2026-05-01T00:00:00Z',
    edited_at: null,
    deleted_at: null,
    deletion_reason: null,
    users: { username: 'somebody', display_name: 'Somebody', avatar_url: null },
    ...overrides,
  }
}

beforeEach(() => {
  sessionState.value = null
  adminState.value = false
  vi.mocked(createAdminSupabaseClient).mockReset()
})

describe('<CommentsSection>', () => {
  it('renders the empty state when there are no comments', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      fakeAdmin([]) as never,
    )
    sessionState.value = null
    const tree = await CommentsSection({ postId: 'post-1' })
    render(tree)
    expect(screen.getByText(/be the first to comment/i)).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /^comments$/i }),
    ).toBeInTheDocument()
  })

  it('shows the "Sign in to comment" affordance for anonymous viewers with no comments', async () => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      fakeAdmin([]) as never,
    )
    sessionState.value = null
    const tree = await CommentsSection({ postId: 'post-1' })
    render(tree)
    expect(
      screen.getByRole('link', { name: /sign in/i }),
    ).toHaveAttribute('href', '/auth/signin')
  })

  it('renders 3 threaded comments and counts only non-deleted in the heading', async () => {
    const rows: RawCommentRow[] = [
      comment({
        id: 'c1',
        body: 'root one',
        created_at: '2026-05-01T00:00:00Z',
      }),
      comment({
        id: 'c2',
        parent_comment_id: 'c1',
        body: 'reply to c1',
        created_at: '2026-05-01T00:01:00Z',
      }),
      comment({
        id: 'c3',
        body: 'root two',
        created_at: '2026-05-01T00:02:00Z',
      }),
    ]
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      fakeAdmin(rows) as never,
    )
    sessionState.value = null

    const tree = await CommentsSection({ postId: 'post-1' })
    const { container } = render(tree)
    expect(
      screen.getByRole('heading', { name: /3 comments/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('root one')).toBeInTheDocument()
    expect(screen.getByText('reply to c1')).toBeInTheDocument()
    expect(screen.getByText('root two')).toBeInTheDocument()

    // Threading structure: the reply must render at depth 2 (root = depth 1).
    const replyNode = container.querySelector('[data-depth="2"]')
    expect(replyNode).not.toBeNull()
    expect(replyNode?.textContent).toContain('reply to c1')
  })

  it('renders the "Sign in to comment" affordance for anonymous viewers with comments', async () => {
    const rows: RawCommentRow[] = [
      comment({ id: 'c1', body: 'hi' }),
    ]
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      fakeAdmin(rows) as never,
    )
    sessionState.value = null

    const tree = await CommentsSection({ postId: 'post-1' })
    render(tree)
    expect(screen.getByText(/sign in to comment/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /reply/i }),
    ).not.toBeInTheDocument()
  })

  it('shows Edit + Delete for the author on their own comment', async () => {
    const rows: RawCommentRow[] = [
      comment({
        id: 'c1',
        author_id: 'me',
        body: 'mine',
        // Recent — within the 24h edit window
        created_at: new Date().toISOString(),
      }),
    ]
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      fakeAdmin(rows) as never,
    )
    sessionState.value = { user: { id: 'me' } }

    const tree = await CommentsSection({ postId: 'post-1' })
    render(tree)
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^delete$/i }),
    ).toBeInTheDocument()
  })

  it('shows only Reply for a signed-in non-author', async () => {
    const rows: RawCommentRow[] = [
      comment({ id: 'c1', author_id: 'someone-else', body: 'theirs' }),
    ]
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      fakeAdmin(rows) as never,
    )
    sessionState.value = { user: { id: 'me' } }
    adminState.value = false

    const tree = await CommentsSection({ postId: 'post-1' })
    render(tree)
    expect(screen.getByRole('button', { name: /reply/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^edit$/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^delete$/i }),
    ).not.toBeInTheDocument()
  })

  it('renders a [removed] placeholder for a soft-deleted parent and still renders its children', async () => {
    const rows: RawCommentRow[] = [
      comment({
        id: 'p1',
        body: 'real body but should be hidden',
        deleted_at: '2026-05-01T00:30:00Z',
        deletion_reason: 'author',
      }),
      comment({
        id: 'c1',
        parent_comment_id: 'p1',
        body: 'still-visible child',
        created_at: '2026-05-01T00:01:00Z',
      }),
    ]
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      fakeAdmin(rows) as never,
    )
    sessionState.value = null

    const tree = await CommentsSection({ postId: 'post-1' })
    render(tree)
    // Heading counts only non-deleted rows
    expect(
      screen.getByRole('heading', { name: /1 comment/i }),
    ).toBeInTheDocument()
    // Child is rendered
    expect(screen.getByText('still-visible child')).toBeInTheDocument()
    // Deleted body is replaced with placeholder
    expect(
      screen.queryByText('real body but should be hidden'),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/\[removed by author\]/i)).toBeInTheDocument()
  })
})

describe('<CommentsSection> — anon listing shows sign-in link inline', () => {
  it('renders a sign-in link inside the thread when comments exist and viewer is anon', async () => {
    const rows: RawCommentRow[] = [
      comment({ id: 'c1', body: 'first' }),
    ]
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      fakeAdmin(rows) as never,
    )
    sessionState.value = null
    const tree = await CommentsSection({ postId: 'post-1' })
    const { container } = render(tree)
    const links = within(container).getAllByRole('link', { name: /sign in/i })
    expect(links.length).toBeGreaterThanOrEqual(1)
  })
})

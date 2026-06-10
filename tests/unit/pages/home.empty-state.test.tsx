/**
 * Phase 13 — home page empty state.
 *
 * The home `/` page wraps its feed query in a Suspense boundary; the
 * empty state lives inside the `FeedList` server component which renders
 * after `getForYouFeed` / `getLatestFeed` returns zero rows. To assert
 * the copy without spinning up Supabase, we walk the server-tree, locate
 * the Suspense child (the async `FeedList`), and await it directly with
 * its resolved props.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports that trigger them
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/supabase/server', () => ({
  createAnonServerSupabaseClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/feed', () => ({
  getForYouFeed: vi.fn(),
  getLatestFeed: vi.fn(),
}))

vi.mock('@/lib/feed/hydrate', () => ({
  fetchAuthors: vi.fn(async () => new Map()),
  fetchOrgsByPost: vi.fn(async () => new Map()),
  fetchTagNames: vi.fn(async () => new Map()),
  fetchTagsByPost: vi.fn(async () => new Map()),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { getSession } from '@/lib/auth'
import { getForYouFeed, getLatestFeed } from '@/lib/feed'
import HomePage from '@/app/page'

// ---------------------------------------------------------------------------
// Tree helpers (shared shape with other phase-13 page tests)
// ---------------------------------------------------------------------------

function collectText(node: React.ReactNode): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join('')
  if (!React.isValidElement(node)) return ''
  const props = node.props as Record<string, unknown>
  return collectText(props.children as React.ReactNode)
}

function findByComponentType(
  tree: React.ReactNode,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  target: (...args: any[]) => any,
): React.ReactElement | null {
  if (tree == null || tree === false || tree === true) return null
  if (Array.isArray(tree)) {
    for (const node of tree) {
      const found = findByComponentType(node, target)
      if (found) return found
    }
    return null
  }
  if (!React.isValidElement(tree)) return null
  if (tree.type === target) return tree
  // Walk ALL ReactNode-valued props (not just `children`) so we can find
  // elements nested inside named slot props like HomeShell's `center` prop.
  const props = tree.props as Record<string, unknown>
  for (const val of Object.values(props)) {
    if (val == null || typeof val !== 'object') continue
    if (React.isValidElement(val) || Array.isArray(val)) {
      const found = findByComponentType(val as React.ReactNode, target)
      if (found) return found
    }
  }
  return null
}

/**
 * Walk an element tree collecting every `<Link href>` so we can assert
 * the empty-state action target without depending on next/link internals.
 */
function collectLinkHrefs(node: React.ReactNode, hrefs: string[] = []): string[] {
  if (node == null || node === false || node === true) return hrefs
  if (Array.isArray(node)) {
    for (const c of node) collectLinkHrefs(c, hrefs)
    return hrefs
  }
  if (!React.isValidElement(node)) return hrefs
  // next/link renders an element whose props include `href`. Capture any
  // element with an `href` prop — covers raw <a> and <Link> alike.
  const props = node.props as { href?: unknown; children?: React.ReactNode }
  if (typeof props.href === 'string') hrefs.push(props.href)
  collectLinkHrefs(props.children, hrefs)
  return hrefs
}

// ---------------------------------------------------------------------------
// Resolve the Suspense child to its rendered output.
// ---------------------------------------------------------------------------

async function renderHomeFeed(): Promise<React.ReactNode> {
  const tree = await HomePage()
  const suspense = findByComponentType(tree, React.Suspense)
  expect(suspense).not.toBeNull()
  const body = (suspense!.props as { children: React.ReactElement }).children
  // body.type is the async FeedList server component
  const BodyFn = body.type as (props: Record<string, unknown>) => Promise<React.ReactNode>
  return await BodyFn(body.props as Record<string, unknown>)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HomePage empty state', () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset()
    vi.mocked(getForYouFeed).mockReset()
    vi.mocked(getLatestFeed).mockReset()
  })

  it('renders the warming-up copy when the anon Latest feed is empty', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getLatestFeed).mockResolvedValue([])

    const body = await renderHomeFeed()
    const text = collectText(body)
    expect(text).toContain('Follow people or wait while the feed warms up.')
    expect(text).toContain('/tags')
  })

  it('renders the warming-up copy when the authed For-You feed is empty', async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: 'user-1', name: 'A', email: 'a@example.com' },
      expires: '2099-12-31T23:59:59.000Z',
    })
    vi.mocked(getForYouFeed).mockResolvedValue([])

    const body = await renderHomeFeed()
    const text = collectText(body)
    expect(text).toContain('Follow people or wait while the feed warms up.')
  })

  it('the empty-state action links to /tags', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getLatestFeed).mockResolvedValue([])

    const body = await renderHomeFeed()
    const hrefs = collectLinkHrefs(body)
    expect(hrefs).toContain('/tags')
  })
})

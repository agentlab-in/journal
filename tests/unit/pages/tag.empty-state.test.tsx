/**
 * Phase 13 — /tag/<slug> empty state.
 *
 * The page makes a top-level tag-existence query (for the breadcrumb +
 * 404 gate), then renders a Suspense whose async child runs the
 * post_tags → posts hydration pipeline. To assert the empty-state copy
 * we mock the Supabase chain so:
 *   - the `tags` lookup returns an approved tag
 *   - the `post_tags` lookup returns zero post ids
 * which short-circuits the inner block (no `posts` query runs) and
 * lands on the empty-state branch with `cards.length === 0`.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentFakeClient: any = {}

vi.mock('@/lib/supabase/server', () => ({
  createAnonServerSupabaseClient: vi.fn(() => currentFakeClient),
}))

vi.mock('@/lib/feed/hydrate', () => ({
  fetchAuthors: vi.fn(async () => new Map()),
  fetchOrgsByPost: vi.fn(async () => new Map()),
  fetchTagsByPost: vi.fn(async () => new Map()),
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  permanentRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_PERMANENT_REDIRECT:${url}`)
  }),
}))

import TagPage from '@/app/tag/[slug]/page'

// ---------------------------------------------------------------------------
// Tree helpers
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
  const props = tree.props as Record<string, unknown>
  const children = props.children as React.ReactNode
  return findByComponentType(children, target)
}

// ---------------------------------------------------------------------------
// Fake Supabase client
// ---------------------------------------------------------------------------

/**
 * Builds a minimal fake client serving the two surfaces the tag page hits:
 *
 *   - `tags`: maybeSingle() returns the approved tag (no parent), used by
 *     both the page-level existence check and the metadata builder.
 *   - `post_tags`: select().eq().limit() returns zero post ids, so the
 *     suspended body skips the `posts` query and falls into the empty
 *     branch.
 */
function makeFakeClient() {
  function tagsChain() {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({
        data: {
          slug: 'agents',
          name: 'agents',
          parent_tag_slug: null,
          is_approved: true,
        },
        error: null,
      })),
    }
  }

  function postTagsChain() {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(async () => ({ data: [], error: null })),
    }
    return chain
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'tags') return tagsChain()
      if (table === 'post_tags') return postTagsChain()
      // posts query path is unreachable when post_tags returns [], but
      // return a noop chain just in case to avoid surprise crashes.
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation(async () => ({ data: [], error: null })),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TagPage empty state', () => {
  beforeEach(() => {
    currentFakeClient = makeFakeClient()
  })

  it('renders "No posts tagged here yet." when zero approved posts exist for the tag', async () => {
    const tree = await TagPage({
      params: Promise.resolve({ slug: 'agents' }),
      searchParams: Promise.resolve({}),
    })

    // Body of the Suspense child is the async TagPostsList — await it
    // directly with its props to materialise the empty state.
    const suspense = findByComponentType(tree, React.Suspense)
    expect(suspense).not.toBeNull()
    const body = (suspense!.props as { children: React.ReactElement }).children
    const BodyFn = body.type as (
      props: Record<string, unknown>,
    ) => Promise<React.ReactNode>
    const bodyTree = await BodyFn(body.props as Record<string, unknown>)

    const text = collectText(bodyTree)
    expect(text).toContain('No posts tagged here yet.')
  })
})

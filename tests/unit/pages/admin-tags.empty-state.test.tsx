/**
 * Phase 13 — /admin/tags empty state.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// F2: the page now runs its own per-request admin guard (defense-in-depth,
// independent of the layout). Stub both so the empty-state assertion below
// doesn't depend on a real session/DB lookup.
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ user: { id: 'admin-1' } })),
}))

vi.mock('@/lib/admin', () => ({
  requireAdmin: vi.fn(async () => 'admin-1'),
}))

vi.mock('@/lib/admin/list-tags', () => ({
  listPendingTags: vi.fn(),
}))

// Stub TagActions — client component, irrelevant to empty-state assertion.
vi.mock('@/components/admin/TagActions', () => ({
  default: () => React.createElement('div', { 'data-testid': 'tag-actions' }),
}))

import { listPendingTags } from '@/lib/admin/list-tags'
import AdminTagsPage from '@/app/admin/tags/page'

function collectText(node: React.ReactNode): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join('')
  if (!React.isValidElement(node)) return ''
  const props = node.props as Record<string, unknown>
  return collectText(props.children as React.ReactNode)
}

describe('AdminTagsPage empty state', () => {
  beforeEach(() => {
    vi.mocked(listPendingTags).mockReset()
  })

  it('renders the "no tags pending approval" copy when no rows', async () => {
    vi.mocked(listPendingTags).mockResolvedValue({
      rows: [],
      nextCursor: null,
    })

    const tree = await AdminTagsPage({
      searchParams: Promise.resolve({}),
    })

    const text = collectText(tree)
    expect(text).toContain('No tags pending approval.')
  })
})

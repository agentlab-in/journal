/**
 * Phase 13 — /admin/reports empty state.
 *
 * Mocks `listUnresolvedReports` to return zero rows and asserts the
 * "All caught up." copy renders. The page is a plain async server
 * component (no Suspense), so we can await it directly.
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

vi.mock('@/lib/admin/list-reports', () => ({
  listUnresolvedReports: vi.fn(),
}))

// Stub ReportActions — it's a client component that pulls in fetch /
// session helpers we don't need for this assertion.
vi.mock('@/components/admin/ReportActions', () => ({
  default: () => React.createElement('div', { 'data-testid': 'report-actions' }),
}))

import { listUnresolvedReports } from '@/lib/admin/list-reports'
import AdminReportsPage from '@/app/admin/reports/page'

function collectText(node: React.ReactNode): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join('')
  if (!React.isValidElement(node)) return ''
  const props = node.props as Record<string, unknown>
  return collectText(props.children as React.ReactNode)
}

describe('AdminReportsPage empty state', () => {
  beforeEach(() => {
    vi.mocked(listUnresolvedReports).mockReset()
  })

  it('renders the "all caught up" copy when no unresolved reports exist', async () => {
    vi.mocked(listUnresolvedReports).mockResolvedValue({
      rows: [],
      nextCursor: null,
    })

    const tree = await AdminReportsPage({
      searchParams: Promise.resolve({}),
    })

    const text = collectText(tree)
    expect(text).toContain('All caught up. No open reports.')
  })
})

/**
 * Unit tests for app/auth/blocked/page.tsx.
 *
 * Covers:
 *   - The "blocked for @<login>" line renders when a valid GitHub
 *     handle is supplied via the `login` query param.
 *   - The reason-specific copy continues to render.
 *   - A hostile login value (e.g. "<script>...") is rejected and the
 *     line is NOT rendered, preventing arbitrary text injection.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import BlockedPage from '@/app/auth/blocked/page'

async function renderPage(params: { reason?: string; login?: string }) {
  const tree = await BlockedPage({ searchParams: Promise.resolve(params) })
  render(tree)
}

describe('BlockedPage', () => {
  it('renders the rejected username + reason copy when login is valid', async () => {
    await renderPage({ reason: 'reserved_name', login: 'harshit' })

    // Username line — case-insensitive match because surrounding copy is
    // lowercase and the handle is rendered with @-prefix.
    expect(screen.getByText(/sign-up blocked for/i)).toBeInTheDocument()
    expect(screen.getByText('@harshit')).toBeInTheDocument()

    // Reason copy
    expect(screen.getByText(/that username is reserved/i)).toBeInTheDocument()
  })

  it('lowercases a mixed-case GitHub handle', async () => {
    await renderPage({ reason: 'no_public_repos', login: 'HarshitSinghBhandari' })
    expect(screen.getByText('@harshitsinghbhandari')).toBeInTheDocument()
  })

  it('drops a hostile login (does not render the username line)', async () => {
    await renderPage({ reason: 'reserved_name', login: '<script>alert(1)</script>' })

    // The "blocked for" line never appears.
    expect(screen.queryByText(/sign-up blocked for/i)).not.toBeInTheDocument()

    // And the raw payload is not anywhere in the document either.
    expect(screen.queryByText(/<script>/)).not.toBeInTheDocument()
    expect(screen.queryByText(/alert/i)).not.toBeInTheDocument()

    // Reason copy still rendered — the page is still useful.
    expect(screen.getByText(/that username is reserved/i)).toBeInTheDocument()
  })

  it('omits the username line when login is absent', async () => {
    await renderPage({ reason: 'no_public_repos' })
    expect(screen.queryByText(/sign-up blocked for/i)).not.toBeInTheDocument()
    expect(screen.getByText(/no public repositories/i)).toBeInTheDocument()
  })

  it('drops a login longer than 39 chars (GitHub max)', async () => {
    await renderPage({
      reason: 'reserved_name',
      login: 'a'.repeat(40),
    })
    expect(screen.queryByText(/sign-up blocked for/i)).not.toBeInTheDocument()
  })
})

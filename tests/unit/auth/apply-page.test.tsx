/**
 * Unit tests for app/auth/apply/page.tsx.
 *
 * Covers the static "how to get in" copy: the invite-only heading, the
 * mailto link, the joke review-time line, the required reply line, and
 * the links to /terms and /auth/signin.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ApplyPage from '@/app/auth/apply/page'

describe('ApplyPage', () => {
  it('renders the invite-only heading', () => {
    render(<ApplyPage />)
    expect(screen.getByText(/agentlab is invite-only/i)).toBeInTheDocument()
  })

  it('renders the mailto link to harshit@agentlab.in', () => {
    render(<ApplyPage />)
    const link = screen.getByRole('link', { name: 'harshit@agentlab.in' })
    expect(link).toHaveAttribute('href', 'mailto:harshit@agentlab.in')
  })

  it('renders the "~200 days" joke review time', () => {
    render(<ApplyPage />)
    expect(screen.getByText(/~200 days/)).toBeInTheDocument()
  })

  it('renders the required reply line', () => {
    render(<ApplyPage />)
    expect(
      screen.getByText(/I agree to the terms at agentlab\.in\/terms/)
    ).toBeInTheDocument()
  })

  it('links to /terms', () => {
    render(<ApplyPage />)
    expect(screen.getByRole('link', { name: 'terms' })).toHaveAttribute(
      'href',
      '/terms'
    )
  })

  it('links to /auth/signin', () => {
    render(<ApplyPage />)
    expect(
      screen.getByRole('link', { name: /already approved\? sign in/i })
    ).toHaveAttribute('href', '/auth/signin')
  })
})

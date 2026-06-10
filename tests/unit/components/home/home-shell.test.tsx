/**
 * <HomeShell /> — named-slot grid wrapper.
 *
 * Coverage:
 *   1. All three slots render their content.
 *   2. Left aside has aria-label="Primary navigation".
 *   3. Right aside has aria-label="Showcase".
 *   4. Component is synchronous — calling HomeShell({...}) must not
 *      return a Promise (Risk 2 mitigation: shell must paint immediately).
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { HomeShell } from '@/components/home/HomeShell'

describe('<HomeShell>', () => {
  it('renders content in all three named slots', () => {
    render(
      <HomeShell
        left={<span data-testid="left-content">left</span>}
        center={<span data-testid="center-content">center</span>}
        right={<span data-testid="right-content">right</span>}
      />,
    )

    expect(screen.getByTestId('left-content')).toBeInTheDocument()
    expect(screen.getByTestId('center-content')).toBeInTheDocument()
    expect(screen.getByTestId('right-content')).toBeInTheDocument()
  })

  it('left aside has aria-label="Primary navigation"', () => {
    render(
      <HomeShell
        left={<span>left</span>}
        center={<span>center</span>}
        right={<span>right</span>}
      />,
    )

    expect(
      screen.getByRole('complementary', { name: 'Primary navigation' }),
    ).toBeInTheDocument()
  })

  it('right aside has aria-label="Showcase"', () => {
    render(
      <HomeShell
        left={<span>left</span>}
        center={<span>center</span>}
        right={<span>right</span>}
      />,
    )

    expect(
      screen.getByRole('complementary', { name: 'Showcase' }),
    ).toBeInTheDocument()
  })

  it('is synchronous — calling HomeShell({...}) does not return a Promise (Risk 2 guard)', () => {
    const result = HomeShell({
      left: <span>left</span>,
      center: <span>center</span>,
      right: <span>right</span>,
    })

    // A Promise has a `.then` method; a React element does not.
    // If this ever fails it means someone added `async` to HomeShell,
    // which would block the shell from painting and break streaming.
    expect(result).not.toHaveProperty('then')
    expect(typeof (result as unknown as { then?: unknown }).then).toBe('undefined')
  })
})

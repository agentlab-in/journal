import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StructuredSections } from '@/components/posts/StructuredSections'

// Mock renderToHtml to avoid spinning up the full unified pipeline
vi.mock('@/lib/posts/render', () => ({
  renderToHtml: async (md: string) => `<p>${md.trim()}</p>`,
}))

describe('StructuredSections', () => {
  it('returns null for type="post" regardless of sections', async () => {
    const result = await StructuredSections({
      type: 'post',
      sections: { environment_target: 'some content' },
    })
    expect(result).toBeNull()
  })

  it('returns null when sections is null', async () => {
    const result = await StructuredSections({ type: 'playbook', sections: null })
    expect(result).toBeNull()
  })

  it('returns null when all section values are null', async () => {
    const result = await StructuredSections({
      type: 'playbook',
      sections: {
        environment_target: null,
        prerequisites: null,
        core_instructions: null,
        safety_failure_modes: null,
      },
    })
    expect(result).toBeNull()
  })

  it('returns null when all section values are empty strings', async () => {
    const result = await StructuredSections({
      type: 'playbook',
      sections: {
        environment_target: '',
        prerequisites: '   ',
        core_instructions: '',
        safety_failure_modes: '',
      },
    })
    expect(result).toBeNull()
  })

  it('renders all 4 playbook section labels when content is present', async () => {
    const element = await StructuredSections({
      type: 'playbook',
      sections: {
        environment_target: 'mac mini',
        prerequisites: 'gh cli',
        core_instructions: 'clone repo',
        safety_failure_modes: "don't push to main",
      },
    })
    expect(element).not.toBeNull()
    render(element as React.ReactElement)
    expect(screen.getByText('Environment / Target')).toBeTruthy()
    expect(screen.getByText('Prerequisites')).toBeTruthy()
    expect(screen.getByText('Core Instructions')).toBeTruthy()
    expect(screen.getByText('Safety / Failure Modes')).toBeTruthy()
  })

  it('renders TL;DR and The Question for dive type', async () => {
    const element = await StructuredSections({
      type: 'dive',
      sections: {
        tldr: 'short answer',
        the_question: 'long form question',
      },
    })
    expect(element).not.toBeNull()
    render(element as React.ReactElement)
    expect(screen.getByText('TL;DR')).toBeTruthy()
    expect(screen.getByText('The Question')).toBeTruthy()
  })

  it('renders each section as a collapsible <details> that defaults to open (issue #70a)', async () => {
    const element = await StructuredSections({
      type: 'playbook',
      sections: {
        environment_target: 'mac mini',
        prerequisites: 'gh cli',
        core_instructions: 'clone repo',
        safety_failure_modes: "don't push to main",
      },
    })
    const { container } = render(element as React.ReactElement)

    const details = container.querySelectorAll('details.structured-section')
    expect(details).toHaveLength(4)
    // Default state is expanded so first-time readers see content immediately.
    details.forEach((d) => expect(d.hasAttribute('open')).toBe(true))

    // Each disclosure is labelled by a <summary> carrying the section heading.
    const summary = container.querySelector(
      'details.structured-section > summary',
    )
    expect(summary).not.toBeNull()
    expect(summary?.querySelector('h2')?.textContent).toBe('Environment / Target')
  })

  it('skips a null section but renders other present ones', async () => {
    const element = await StructuredSections({
      type: 'playbook',
      sections: {
        environment_target: 'mac mini',
        prerequisites: null,
        core_instructions: 'clone repo',
        safety_failure_modes: null,
      },
    })
    expect(element).not.toBeNull()
    render(element as React.ReactElement)
    expect(screen.getByText('Environment / Target')).toBeTruthy()
    expect(screen.queryByText('Prerequisites')).toBeNull()
    expect(screen.getByText('Core Instructions')).toBeTruthy()
    expect(screen.queryByText('Safety / Failure Modes')).toBeNull()
  })
})

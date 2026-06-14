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

  it('wraps the four playbook sections in ONE <details> that defaults closed', async () => {
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

    // Exactly one disclosure wraps the whole block (no per-section <details>).
    const allDetails = container.querySelectorAll('details')
    expect(allDetails).toHaveLength(1)
    const disclosure = container.querySelector(
      'details.structured-sections__disclosure',
    )
    expect(disclosure).not.toBeNull()

    // Default state is CLOSED — the structured spec stays out of the way.
    expect(disclosure?.hasAttribute('open')).toBe(false)

    // The single summary carries the block heading + a chevron.
    const summary = disclosure?.querySelector(':scope > summary')
    expect(summary).not.toBeNull()
    expect(summary?.querySelector('h2')?.textContent).toBe('Playbook details')
    expect(summary?.querySelector('svg')).not.toBeNull()

    // The four section headings are plain <h3>s inside the disclosure, not
    // collapsible triggers.
    const headings = Array.from(
      disclosure?.querySelectorAll('h3.structured-section__heading') ?? [],
    ).map((h) => h.textContent)
    expect(headings).toEqual([
      'Environment / Target',
      'Prerequisites',
      'Core Instructions',
      'Safety / Failure Modes',
    ])
  })

  it('keeps dive sections as individual <details> that default open (unchanged from #70a)', async () => {
    const element = await StructuredSections({
      type: 'dive',
      sections: {
        tldr: 'short answer',
        the_question: 'long form question',
      },
    })
    const { container } = render(element as React.ReactElement)

    // Two separate per-section disclosures — the dive page is intentionally
    // left as PR #73 shipped it.
    const details = container.querySelectorAll('details.structured-section')
    expect(details).toHaveLength(2)
    details.forEach((d) => expect(d.hasAttribute('open')).toBe(true))

    // No single-wrapper disclosure on dive pages.
    expect(
      container.querySelector('details.structured-sections__disclosure'),
    ).toBeNull()

    // Each disclosure is labelled by a <summary> carrying an <h2> heading.
    const firstSummary = container.querySelector(
      'details.structured-section > summary',
    )
    expect(firstSummary?.querySelector('h2')?.textContent).toBe('TL;DR')
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

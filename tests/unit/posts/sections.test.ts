import { describe, it, expect } from 'vitest'
import { extractStructuredSections } from '@/lib/posts/sections'

const playbookBody = [
  '## Environment / Target',
  'mac mini, claude code 0.3.x',
  '',
  '## Prerequisites',
  '- gh cli',
  '- node 24',
  '',
  '## Core Instructions',
  '1. clone repo',
  '2. run pnpm install',
  '',
  '## Safety / Failure Modes',
  "don't push to main",
].join('\n')

const diveBody = [
  '## TL;DR',
  'short answer here',
  '',
  '## The Question',
  'long form question',
].join('\n')

describe('extractStructuredSections', () => {
  it('returns null for post type regardless of body', () => {
    expect(extractStructuredSections(playbookBody, 'post')).toBeNull()
    expect(extractStructuredSections('', 'post')).toBeNull()
  })

  it('extracts all four playbook sections by canonical heading', () => {
    const out = extractStructuredSections(playbookBody, 'playbook')
    expect(out).toEqual({
      environment_target: 'mac mini, claude code 0.3.x',
      prerequisites: '- gh cli\n- node 24',
      core_instructions: '1. clone repo\n2. run pnpm install',
      safety_failure_modes: "don't push to main",
    })
  })

  it('extracts both dive sections', () => {
    const out = extractStructuredSections(diveBody, 'dive')
    expect(out).toEqual({
      tldr: 'short answer here',
      the_question: 'long form question',
    })
  })

  it('returns null section value when heading is missing', () => {
    const partial = '## Environment / Target\nfoo'
    const out = extractStructuredSections(partial, 'playbook')
    expect(out).toEqual({
      environment_target: 'foo',
      prerequisites: null,
      core_instructions: null,
      safety_failure_modes: null,
    })
  })

  it('captures content until the next canonical H2 (ignores other H2s in between)', () => {
    const body = [
      '## TL;DR',
      'pre note',
      '## Side Note',
      'random aside that should still be inside tldr',
      '## The Question',
      'q body',
    ].join('\n')
    const out = extractStructuredSections(body, 'dive')
    expect(out?.tldr).toContain('pre note')
    expect(out?.tldr).toContain('random aside that should still be inside tldr')
    expect(out?.the_question).toBe('q body')
  })
})

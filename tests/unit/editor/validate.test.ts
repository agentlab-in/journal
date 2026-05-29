/**
 * validatePublishable — unit tests
 *
 * Mirrors the Phase 3 brief's publish-button rules:
 *   - title length >= 5
 *   - summary length 10..200
 *   - body_md length >= 50
 *   - type set (post | playbook | dive)
 *   - >= 1 tag selected
 *   - Playbook bodies must contain the 4 canonical H2 headings
 *   - Deep Dive bodies must contain the 2 canonical H2 headings
 */
import { describe, it, expect } from 'vitest'
import { validatePublishable } from '@/lib/editor/validate'
import type { TagOption } from '@/components/editor/TagPicker'

function tag(slug: string): TagOption {
  return { slug, name: slug, parent_tag_slug: null }
}

const validPostBody = 'a'.repeat(60) // 60 chars, ample
const validPlaybookBody = [
  '## Environment / Target',
  'some text',
  '## Prerequisites',
  'more text',
  '## Core Instructions',
  'and more',
  '## Safety / Failure Modes',
  'closing notes for the playbook body',
].join('\n')
const validDiveBody = [
  '## TL;DR',
  'short summary',
  '## The Question',
  'the rest of the body needs to be at least fifty chars long ok',
].join('\n')

describe('validatePublishable — happy path', () => {
  it('passes for a valid post', () => {
    const result = validatePublishable({
      title: 'Hello world',
      summary: 'A good summary of the post.',
      body_md: validPostBody,
      type: 'post',
      tags: [tag('rag')],
      structured_sections: null,
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('passes for a valid playbook with all 4 headings', () => {
    const result = validatePublishable({
      title: 'A solid playbook',
      summary: 'Playbook for X scenario.',
      body_md: validPlaybookBody,
      type: 'playbook',
      tags: [tag('rag')],
      structured_sections: null,
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('passes for a valid deep dive with both required headings', () => {
    const result = validatePublishable({
      title: 'Deep dive on Y',
      summary: 'A thoughtful look.',
      body_md: validDiveBody,
      type: 'dive',
      tags: [tag('rag')],
      structured_sections: null,
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })
})

describe('validatePublishable — field rules', () => {
  it('flags title shorter than 5 chars', () => {
    const result = validatePublishable({
      title: 'Hi',
      summary: 'A good summary of the post.',
      body_md: validPostBody,
      type: 'post',
      tags: [tag('rag')],
      structured_sections: null,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /title/i.test(e))).toBe(true)
  })

  it('flags summary shorter than 10 chars', () => {
    const result = validatePublishable({
      title: 'Hello world',
      summary: 'short',
      body_md: validPostBody,
      type: 'post',
      tags: [tag('rag')],
      structured_sections: null,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /summary/i.test(e))).toBe(true)
  })

  it('flags summary longer than 200 chars', () => {
    const result = validatePublishable({
      title: 'Hello world',
      summary: 'x'.repeat(201),
      body_md: validPostBody,
      type: 'post',
      tags: [tag('rag')],
      structured_sections: null,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /summary/i.test(e))).toBe(true)
  })

  it('flags body shorter than 50 chars', () => {
    const result = validatePublishable({
      title: 'Hello world',
      summary: 'A good summary of the post.',
      body_md: 'too short',
      type: 'post',
      tags: [tag('rag')],
      structured_sections: null,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /body/i.test(e))).toBe(true)
  })

  it('flags zero tags', () => {
    const result = validatePublishable({
      title: 'Hello world',
      summary: 'A good summary of the post.',
      body_md: validPostBody,
      type: 'post',
      tags: [],
      structured_sections: null,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /tag/i.test(e))).toBe(true)
  })
})

describe('validatePublishable — structured sections', () => {
  it('flags a playbook missing one of the 4 required headings', () => {
    const missingSafety = [
      '## Environment / Target',
      '## Prerequisites',
      '## Core Instructions',
      'no safety here, sadly. but the body is plenty long.',
    ].join('\n')
    const result = validatePublishable({
      title: 'Bad playbook',
      summary: 'Missing one heading.',
      body_md: missingSafety,
      type: 'playbook',
      tags: [tag('rag')],
      structured_sections: null,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /safety/i.test(e))).toBe(true)
  })

  it('flags a deep dive missing the TL;DR heading', () => {
    const missingTldr = [
      '## The Question',
      'the question is here, but TL;DR is missing entirely from this body.',
    ].join('\n')
    const result = validatePublishable({
      title: 'Bad dive',
      summary: 'Missing tldr heading.',
      body_md: missingTldr,
      type: 'dive',
      tags: [tag('rag')],
      structured_sections: null,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /tl;?dr/i.test(e))).toBe(true)
  })

  it('flags a deep dive missing the Question heading', () => {
    const missingQuestion = [
      '## TL;DR',
      'a tldr is here, but the question heading is missing entirely from this body.',
    ].join('\n')
    const result = validatePublishable({
      title: 'Bad dive 2',
      summary: 'Missing question heading.',
      body_md: missingQuestion,
      type: 'dive',
      tags: [tag('rag')],
      structured_sections: null,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /question/i.test(e))).toBe(true)
  })
})

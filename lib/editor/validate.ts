/**
 * Pure validation helper for the editor's Publish button.
 *
 * Returns the canonical list of human-readable error messages for the
 * current draft. An empty list means the draft is publishable.
 *
 * Rules (Phase 3 brief):
 *   - title length >= 5
 *   - summary length 10..200
 *   - body_md length >= 50
 *   - type set (caller passes a DraftType — typing already enforces this,
 *     but we keep an explicit check so the helper can also be called from
 *     a context where the value is widened)
 *   - >= 1 tag
 *   - playbook: body must contain ALL FOUR canonical H2 headings
 *   - dive:     body must contain BOTH canonical H2 headings
 *
 * The function is pure (no I/O, no time) so it's safe to call on every
 * keystroke for the Publish-button enable + tooltip.
 */
import type { DraftType } from '@/lib/drafts'
import type { TagOption } from '@/components/editor/TagPicker'

export interface ValidatePublishableInput {
  title: string
  summary: string
  body_md: string
  type: DraftType
  tags: TagOption[]
  structured_sections: Record<string, string> | null
}

export interface ValidatePublishableResult {
  valid: boolean
  errors: string[]
}

// Canonical H2 markers per type. Kept as ATX-prefixed strings so we can
// match a `## Heading` line case-sensitively. The brief defines the
// playbook template as `## Environment / Target\n\n## Prerequisites\n\n
// ## Core Instructions\n\n## Safety / Failure Modes\n` and the dive
// template as `## TL;DR\n\n## The Question\n`.
const PLAYBOOK_HEADINGS = [
  '## Environment / Target',
  '## Prerequisites',
  '## Core Instructions',
  '## Safety / Failure Modes',
] as const

const DIVE_HEADINGS = ['## TL;DR', '## The Question'] as const

const TITLE_MIN = 5
const SUMMARY_MIN = 10
const SUMMARY_MAX = 200
const BODY_MIN = 50

function hasHeading(body: string, heading: string): boolean {
  // Match at line start (start-of-string or after a newline), ignoring
  // leading whitespace. We match the exact heading text so a typo'd
  // section title still fails — the brief's structured sections rely
  // on these exact strings to feed `structured_sections` downstream.
  const lines = body.split('\n')
  return lines.some((line) => line.trimStart().startsWith(heading))
}

export function validatePublishable(
  input: ValidatePublishableInput,
): ValidatePublishableResult {
  const errors: string[] = []

  if (input.title.trim().length < TITLE_MIN) {
    errors.push(`Title must be at least ${TITLE_MIN} characters`)
  }

  const summaryLen = input.summary.trim().length
  if (summaryLen < SUMMARY_MIN) {
    errors.push(`Summary must be at least ${SUMMARY_MIN} characters`)
  } else if (summaryLen > SUMMARY_MAX) {
    errors.push(`Summary must be at most ${SUMMARY_MAX} characters`)
  }

  if (input.body_md.trim().length < BODY_MIN) {
    errors.push(`Body must be at least ${BODY_MIN} characters`)
  }

  if (
    input.type !== 'post' &&
    input.type !== 'playbook' &&
    input.type !== 'dive'
  ) {
    errors.push('Post type must be set')
  }

  if (input.tags.length < 1) {
    errors.push('At least one tag is required')
  }

  if (input.type === 'playbook') {
    const missing = PLAYBOOK_HEADINGS.filter(
      (h) => !hasHeading(input.body_md, h),
    ).map((h) => h.replace(/^##\s*/, ''))
    if (missing.length > 0) {
      const label = missing.length === 1 ? 'section' : 'sections'
      errors.push(`Playbook is missing required ${label}: ${missing.join(', ')}`)
    }
  } else if (input.type === 'dive') {
    const missing = DIVE_HEADINGS.filter(
      (h) => !hasHeading(input.body_md, h),
    ).map((h) => h.replace(/^##\s*/, ''))
    if (missing.length > 0) {
      const label = missing.length === 1 ? 'section' : 'sections'
      errors.push(`Deep dive is missing required ${label}: ${missing.join(', ')}`)
    }
  }

  return { valid: errors.length === 0, errors }
}

// Body templates, exported so the editor can pre-fill them when the
// author switches type and validation can stay in sync with the
// canonical headings above.
export const BODY_TEMPLATES: Record<DraftType, string> = {
  post: '',
  playbook:
    '## Environment / Target\n\n## Prerequisites\n\n## Core Instructions\n\n## Safety / Failure Modes\n',
  dive: '## TL;DR\n\n## The Question\n',
}

// Pattern template insertable from the toolbar for free-form posts.
export const PATTERN_TEMPLATE =
  '## Problem\n\n## Structure\n\n## Trade-offs\n\n## Related\n'

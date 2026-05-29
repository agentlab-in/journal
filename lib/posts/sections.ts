import type { PostType } from './url'

const PLAYBOOK_HEADINGS = [
  ['## Environment / Target', 'environment_target'],
  ['## Prerequisites', 'prerequisites'],
  ['## Core Instructions', 'core_instructions'],
  ['## Safety / Failure Modes', 'safety_failure_modes'],
] as const

const DIVE_HEADINGS = [
  ['## TL;DR', 'tldr'],
  ['## The Question', 'the_question'],
] as const

type Spec = readonly (readonly [string, string])[]

function extract(body: string, spec: Spec): Record<string, string | null> {
  const lines = body.split('\n')
  const markerLines = new Map<number, string>()
  for (const [heading, key] of spec) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trimStart().startsWith(heading)) {
        markerLines.set(i, key)
        break
      }
    }
  }
  const result: Record<string, string | null> = Object.fromEntries(
    spec.map(([, k]) => [k, null]),
  )
  const sortedIdx = [...markerLines.keys()].sort((a, b) => a - b)
  for (let i = 0; i < sortedIdx.length; i++) {
    const start = sortedIdx[i] + 1
    const end = i + 1 < sortedIdx.length ? sortedIdx[i + 1] : lines.length
    const key = markerLines.get(sortedIdx[i])!
    result[key] = lines.slice(start, end).join('\n').trim()
  }
  return result
}

export function extractStructuredSections(
  body_md: string,
  type: PostType,
): Record<string, string | null> | null {
  if (type === 'post') return null
  if (type === 'playbook') return extract(body_md, PLAYBOOK_HEADINGS)
  if (type === 'dive') return extract(body_md, DIVE_HEADINGS)
  return null
}

import type { PostType } from '@/lib/posts/url'
import { renderToHtml } from '@/lib/posts/render'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { MdxFailedFallback } from '@/components/error/MdxFailedFallback'

export interface StructuredSectionsProps {
  type: PostType
  sections: Record<string, string | null> | null
}

const PLAYBOOK_SPEC: readonly (readonly [string, string])[] = [
  ['environment_target', 'Environment / Target'],
  ['prerequisites', 'Prerequisites'],
  ['core_instructions', 'Core Instructions'],
  ['safety_failure_modes', 'Safety / Failure Modes'],
]

const DIVE_SPEC: readonly (readonly [string, string])[] = [
  ['tldr', 'TL;DR'],
  ['the_question', 'The Question'],
]

export async function StructuredSections({
  type,
  sections,
}: StructuredSectionsProps) {
  if (type === 'post') return null
  if (sections == null) return null

  const spec = type === 'playbook' ? PLAYBOOK_SPEC : DIVE_SPEC

  const present = spec.filter(([key]) => {
    const val = sections[key]
    return val != null && val.trim() !== ''
  })

  if (present.length === 0) return null

  const rendered = await Promise.all(
    present.map(async ([key, label]) => {
      const content = sections[key] as string
      const html = await renderToHtml(content, { resolveAnchor: () => null })
      return { key, label, html }
    }),
  )

  return (
    <aside className="structured-sections">
      {rendered.map(({ key, label, html }) => (
        <section key={key}>
          <h2>{label}</h2>
          {/* Per-section boundary — one broken MDX payload shouldn't
              take down its siblings. The label scopes the fallback
              copy ("Couldn't render this <label>"). */}
          <ErrorBoundary
            resetKey={html}
            fallback={<MdxFailedFallback context={label.toLowerCase()} />}
          >
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </ErrorBoundary>
        </section>
      ))}
    </aside>
  )
}

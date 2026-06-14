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

  // Per-section content, shared by both layouts. A per-section error boundary
  // keeps one broken MDX payload from taking down its siblings; the label
  // scopes the fallback copy ("Couldn't render this <label>").
  const body = (key: string, label: string, html: string) => (
    <ErrorBoundary
      resetKey={html}
      fallback={<MdxFailedFallback context={label.toLowerCase()} />}
    >
      <div
        className="structured-section__body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </ErrorBoundary>
  )

  // Playbook: the four structured sections are wrapped in ONE native
  // <details> that defaults CLOSED. A playbook's structured spec is reference
  // material for re-reading, so it stays out of the way until expanded; the
  // section headings inside are plain <h3>s, not collapsible triggers.
  // (Walks back issue #70(a)'s individually-collapsible/default-open design.)
  if (type === 'playbook') {
    return (
      <aside className="structured-sections">
        <details className="structured-sections__disclosure">
          <summary className="structured-sections__summary">
            <h2 className="structured-sections__summary-label">
              Playbook details
            </h2>
            <ChevronIcon />
          </summary>
          <div className="structured-sections__content">
            {rendered.map(({ key, label, html }) => (
              <section key={key} className="structured-section">
                <h3 className="structured-section__heading">{label}</h3>
                {body(key, label, html)}
              </section>
            ))}
          </div>
        </details>
      </aside>
    )
  }

  // Deep dive: each section stays a native <details>, default-open so
  // first-time readers see the TL;DR / The Question hook immediately —
  // collapsing is for re-reading. Native <details>/<summary> keeps this a
  // zero-JS server component: the toggle works without hydration.
  return (
    <aside className="structured-sections">
      {rendered.map(({ key, label, html }) => (
        <details key={key} className="structured-section" open>
          <summary className="structured-section__summary">
            <h2 className="structured-section__heading">{label}</h2>
          </summary>
          {body(key, label, html)}
        </details>
      ))}
    </aside>
  )
}

/**
 * Inline chevron — no icon library. `currentColor` so it tracks the summary
 * text color across themes; CSS rotates it when the parent <details> is open.
 */
function ChevronIcon() {
  return (
    <svg
      className="structured-sections__chevron"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

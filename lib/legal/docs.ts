/**
 * Registry of operator-authored legal documents.
 *
 * `slug` is the public URL segment under app/(legal); `file` is the
 * markdown source in /legal at the repo root. `title` drives the page
 * title and JSON-LD; `description` is the meta description and OG copy.
 *
 * There is a single doc: terms + privacy collapsed into one page
 * (see docs/go-public-plan.md, Phase 3). Every other legal URL
 * redirects to it via next.config.ts.
 */
export interface LegalDoc {
  slug: 'terms'
  file: string
  title: string
  description: string
}

export const LEGAL_DOCS: readonly LegalDoc[] = [
  {
    slug: 'terms',
    file: 'terms-of-service.md',
    title: 'Terms and Privacy',
    description:
      'The terms you accept by using agentlab.in and the privacy notice for the data it holds.',
  },
] as const

export function getLegalDoc(slug: LegalDoc['slug']): LegalDoc {
  const doc = LEGAL_DOCS.find((d) => d.slug === slug)
  if (!doc) throw new Error(`Unknown legal doc slug: ${slug}`)
  return doc
}

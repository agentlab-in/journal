/**
 * Registry of operator-authored legal documents.
 *
 * `slug` is the public URL segment under app/(legal); `file` is the
 * markdown source in /legal at the repo root. `title` drives the page
 * title and JSON-LD; `description` is the meta description and OG copy.
 *
 * Adding a new doc means: drop a markdown file in /legal, append an
 * entry here, mirror the slug in lib/reserved-names.ts, add the route
 * to app/sitemap.ts, and surface it in components/layout/Footer.tsx.
 */
export interface LegalDoc {
  slug: 'privacy' | 'terms' | 'policy' | 'grievance' | 'dmca'
  file: string
  title: string
  description: string
}

export const LEGAL_DOCS: readonly LegalDoc[] = [
  {
    slug: 'privacy',
    file: 'privacy-policy.md',
    title: 'Privacy Policy',
    description:
      'How agentlab.in collects, stores, and handles your data — and the rights you have over it.',
  },
  {
    slug: 'terms',
    file: 'terms-of-service.md',
    title: 'Terms of Service',
    description:
      'The agreement between you and agentlab.in covering account use, content ownership, moderation, and liability.',
  },
  {
    slug: 'policy',
    file: 'content-policy.md',
    title: 'Content Policy',
    description:
      'What you can and cannot post on agentlab.in, how moderation works, and how to report problems.',
  },
  {
    slug: 'grievance',
    file: 'grievance-officer.md',
    title: 'Grievance Officer Notice',
    description:
      'Statutory grievance officer details and process under the Indian Intermediary Guidelines 2021.',
  },
  {
    slug: 'dmca',
    file: 'dmca-policy.md',
    title: 'Copyright Takedown Policy',
    description:
      'Notice-and-takedown process for alleged copyright infringement on agentlab.in.',
  },
] as const

export function getLegalDoc(slug: LegalDoc['slug']): LegalDoc {
  const doc = LEGAL_DOCS.find((d) => d.slug === slug)
  if (!doc) throw new Error(`Unknown legal doc slug: ${slug}`)
  return doc
}

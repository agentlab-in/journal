import type { Metadata } from 'next'
import { getLegalDoc, type LegalDoc } from './docs'

/**
 * Build the `Metadata` export for a /(legal)/<slug>/page.tsx route.
 *
 * - `title` is the bare doc title; the root layout template appends
 *   ` — agentlab.in`, producing e.g. `Privacy Policy — agentlab.in`.
 * - Canonical URL points at the slug. Legal pages are explicitly
 *   indexable; we restate `robots` here so a future change to the
 *   site-wide default cannot accidentally hide them.
 */
export function legalMetadata(slug: LegalDoc['slug']): Metadata {
  const doc = getLegalDoc(slug)
  return {
    title: doc.title,
    description: doc.description,
    alternates: { canonical: `/${doc.slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      title: `${doc.title} — agentlab.in`,
      description: doc.description,
      url: `/${doc.slug}`,
      type: 'article',
    },
    twitter: {
      card: 'summary',
      title: `${doc.title} — agentlab.in`,
      description: doc.description,
    },
  }
}

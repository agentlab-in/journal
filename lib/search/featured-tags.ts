/**
 * The same featured-tag slug list the `/tags` directory uses for its
 * "Featured" grid. Lives here (rather than inline in app/tags/page.tsx)
 * so the /search page can render the same chips as quick-filter suggestions
 * in its empty state without duplicating the list.
 *
 * These slugs ship pre-approved in the seed (see Phase 9 spec).
 */

export const FEATURED_TAG_SLUGS = [
  'security',
  'local-first',
  'orchestration',
  'memory',
  'evals',
  'tooling',
  'prompting',
  'multi-agent',
] as const

export type FeaturedTagSlug = (typeof FEATURED_TAG_SLUGS)[number]

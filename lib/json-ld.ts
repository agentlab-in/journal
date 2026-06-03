/**
 * schema.org JSON-LD emitters for post + profile pages.
 *
 * Returned strings are intended to be dropped straight into a
 * `<script type="application/ld+json" dangerouslySetInnerHTML>` tag —
 * the final `</` → `<\/` escape keeps a stray `</script>` substring
 * inside any user-supplied field from breaking out of the script tag
 * (forward-slash escapes are legal JSON, so the payload still parses).
 *
 * Null fields are omitted entirely so schema.org validators don't flag
 * explicit nulls.
 */
import { absoluteUrl } from './site-url'
import type { PostType } from './posts/url'

export interface ArticleJsonLdInput {
  type: PostType
  title: string
  summary: string
  coverImageUrl: string | null
  publishedAt: string
  editedAt: string | null
  canonicalPath: string
  authorName: string
  authorUsername: string
  /**
   * When set, the post is authored under an org. The publisher field
   * becomes the Organization (with the org's url + logo) instead of the
   * generic agentlab.in publisher; the human author still rides on the
   * `author` field as a Person.
   */
  org?: {
    slug: string
    displayName: string
    avatarUrl: string | null
  } | null
}

export interface PersonJsonLdInput {
  username: string
  displayName: string
  bio: string | null
  avatarUrl: string | null
  githubLogin: string | null
}

export interface OrganizationJsonLdInput {
  /** Public URL segment for the org (orgs.slug). */
  slug: string
  displayName: string
  bio: string | null
  avatarUrl: string | null
}

/** Drop keys whose value is `undefined`. Null values are left as-is. */
function pruneInPlace<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) {
    if (obj[k as keyof T] === undefined) delete obj[k as keyof T]
  }
  return obj
}

/**
 * Render `JSON.stringify(payload)` with a final `</` → `<\/` pass so the
 * string is safe to inline inside a `<script>` tag.
 */
function toScriptSafeJson(payload: unknown): string {
  return JSON.stringify(payload).replace(/<\//g, '<\\/')
}

export function articleJsonLd(input: ArticleJsonLdInput): string {
  const schemaType = input.type === 'dive' ? 'TechArticle' : 'Article'
  // Prefer the post's own cover; fall back to the per-post OG image route
  // (always serves a post-specific card via next/og) rather than the
  // generic site /og.png — Google Rich Results favors article-specific
  // images.
  const imageUrl = input.coverImageUrl
    ? absoluteUrl(input.coverImageUrl)
    : absoluteUrl(`${input.canonicalPath}/opengraph-image`)

  const payload = pruneInPlace({
    '@context': 'https://schema.org',
    '@type': schemaType,
    headline: input.title,
    description: input.summary,
    image: imageUrl,
    datePublished: input.publishedAt,
    dateModified: input.editedAt ?? input.publishedAt,
    author: {
      '@type': 'Person',
      name: input.authorName,
      url: absoluteUrl(`/${input.authorUsername}`),
    },
    publisher: input.org
      ? pruneInPlace({
          '@type': 'Organization',
          name: input.org.displayName,
          url: absoluteUrl(`/${input.org.slug}`),
          logo: input.org.avatarUrl
            ? {
                '@type': 'ImageObject',
                url: input.org.avatarUrl,
              }
            : undefined,
        })
      : {
          '@type': 'Organization',
          name: 'agentlab.in',
          logo: {
            '@type': 'ImageObject',
            url: absoluteUrl('/icon.png'),
          },
        },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': absoluteUrl(input.canonicalPath),
    },
  })

  return toScriptSafeJson(payload)
}

export function organizationJsonLd(input: OrganizationJsonLdInput): string {
  const payload = pruneInPlace({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: input.displayName,
    alternateName: `@${input.slug}`,
    url: absoluteUrl(`/${input.slug}`),
    image: input.avatarUrl ?? undefined,
    logo: input.avatarUrl ?? undefined,
    description: input.bio ?? undefined,
  })

  return toScriptSafeJson(payload)
}

export function personJsonLd(input: PersonJsonLdInput): string {
  const payload = pruneInPlace({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: input.displayName,
    alternateName: `@${input.username}`,
    url: absoluteUrl(`/${input.username}`),
    // Skip image/description/sameAs keys entirely when absent — validators
    // flag explicit nulls.
    image: input.avatarUrl ?? undefined,
    description: input.bio ?? undefined,
    sameAs: input.githubLogin
      ? [`https://github.com/${input.githubLogin}`]
      : undefined,
  })

  return toScriptSafeJson(payload)
}

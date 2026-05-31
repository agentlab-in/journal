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
}

export interface PersonJsonLdInput {
  username: string
  displayName: string
  bio: string | null
  avatarUrl: string | null
  githubLogin: string | null
}

/** Drop keys whose value is `undefined`. Null values are left as-is. */
function prune<T extends Record<string, unknown>>(obj: T): T {
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
  const imageUrl = absoluteUrl(input.coverImageUrl ?? '/og.png')

  const payload = prune({
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
    publisher: {
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

export function personJsonLd(input: PersonJsonLdInput): string {
  const payload = prune({
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

import type { MetadataRoute } from 'next'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { absoluteUrl } from '@/lib/site-url'
import { LEGAL_DOCS } from '@/lib/legal/docs'
import { renderLegalDoc } from '@/lib/legal/render'

// Content changes on every publish/edit; don't statically prerender.
// Also avoids requiring Supabase env at build time in CI.
export const dynamic = 'force-dynamic'

// Service-role client so soft-deleted posts and unapproved tags are
// filtered by our explicit WHERE clauses, not by RLS surprises.

interface PostRow {
  slug: string
  type: string
  edited_at: string | null
  published_at: string
  users: {
    username: string
    updated_at: string
  }
  // Left join — null on personal posts. Phase 11 added orgs as an
  // alternate URL leading segment; org-authored posts canonicalize at
  // /<org-slug>/<type>/<slug>.
  orgs: {
    slug: string
  } | null
}

interface TagRow {
  slug: string
  approved_at: string | null
}

interface OrgRow {
  slug: string
  updated_at: string
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = createServerSupabaseClient()

  const { data: postsData } = await db
    .from('posts')
    .select(
      'slug, type, edited_at, published_at, users!inner(username, updated_at), orgs!left(slug)',
    )
    .is('deleted_at', null)

  const { data: tagsData } = await db
    .from('tags')
    .select('slug, approved_at')
    .eq('is_approved', true)

  // Phase 11: emit profile entries for active (not soft-deleted /
  // banned) orgs. The posts query alone is org-agnostic, but we want
  // every active org to be discoverable even without posts.
  const { data: orgsData } = await db
    .from('orgs')
    .select('slug, updated_at')
    .is('deleted_at', null)
    .is('banned_at', null)

  // Supabase types the inner !inner join as an array but at runtime the
  // shape is singular for a one-to-one FK — same cast the rest of the
  // repo uses (see lib/posts/lookup.ts).
  const posts = (postsData ?? []) as unknown as PostRow[]
  const tags = (tagsData ?? []) as unknown as TagRow[]
  const orgs = (orgsData ?? []) as unknown as OrgRow[]

  const now = new Date()

  const staticEntries: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), lastModified: now },
    { url: absoluteUrl('/latest'), lastModified: now },
    { url: absoluteUrl('/tags'), lastModified: now },
    { url: absoluteUrl('/search'), lastModified: now },
  ]

  // Legal pages. lastmod comes from each doc's `**Effective Date:**`
  // line so the sitemap reflects the actual revision date, not the
  // sitemap-build time.
  const legalEntries: MetadataRoute.Sitemap = await Promise.all(
    LEGAL_DOCS.map(async (doc) => {
      const { effectiveDate } = await renderLegalDoc(doc.slug)
      return {
        url: absoluteUrl(`/${doc.slug}`),
        lastModified: effectiveDate,
      }
    }),
  )

  const postEntries: MetadataRoute.Sitemap = posts.map((p) => ({
    // Org-authored posts canonicalize under the org slug. Personal
    // posts under the author username. Matches lookupPost's resolution
    // order and what the publish API has been emitting since T3.
    url: absoluteUrl(`/${p.orgs?.slug ?? p.users.username}/${p.type}/${p.slug}`),
    lastModified: p.edited_at ?? p.published_at,
  }))

  // Profiles-with-posts: dedupe by username; one entry per author. We
  // only emit a profile entry for the personal-post path so the same
  // username doesn't double-count when an author also publishes to an
  // org under a different leading segment.
  const profileMap = new Map<string, string>()
  for (const p of posts) {
    if (p.orgs) continue
    if (!profileMap.has(p.users.username)) {
      profileMap.set(p.users.username, p.users.updated_at)
    }
  }
  const profileEntries: MetadataRoute.Sitemap = Array.from(profileMap).map(
    ([username, updatedAt]) => ({
      url: absoluteUrl(`/${username}`),
      lastModified: updatedAt,
    }),
  )

  const orgEntries: MetadataRoute.Sitemap = orgs.map((o) => ({
    url: absoluteUrl(`/${o.slug}`),
    lastModified: o.updated_at,
  }))

  const tagEntries: MetadataRoute.Sitemap = tags.map((t) => ({
    url: absoluteUrl(`/tag/${t.slug}`),
    lastModified: t.approved_at ?? undefined,
  }))

  return [
    ...staticEntries,
    ...legalEntries,
    ...postEntries,
    ...profileEntries,
    ...orgEntries,
    ...tagEntries,
  ]
}

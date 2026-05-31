import type { MetadataRoute } from 'next'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { absoluteUrl } from '@/lib/site-url'

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
}

interface TagRow {
  slug: string
  approved_at: string | null
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = createServerSupabaseClient()

  const { data: postsData } = await db
    .from('posts')
    .select('slug, type, edited_at, published_at, users!inner(username, updated_at)')
    .is('deleted_at', null)

  const { data: tagsData } = await db
    .from('tags')
    .select('slug, approved_at')
    .eq('is_approved', true)

  // Supabase types the inner !inner join as an array but at runtime the
  // shape is singular for a one-to-one FK — same cast the rest of the
  // repo uses (see lib/posts/lookup.ts).
  const posts = (postsData ?? []) as unknown as PostRow[]
  const tags = (tagsData ?? []) as unknown as TagRow[]

  const now = new Date()

  // TODO: add legal pages once they ship (#28)
  const staticEntries: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), lastModified: now },
    { url: absoluteUrl('/latest'), lastModified: now },
    { url: absoluteUrl('/tags'), lastModified: now },
    { url: absoluteUrl('/search'), lastModified: now },
  ]

  const postEntries: MetadataRoute.Sitemap = posts.map((p) => ({
    url: absoluteUrl(`/${p.users.username}/${p.type}/${p.slug}`),
    lastModified: p.edited_at ?? p.published_at,
  }))

  // Profiles-with-posts: dedupe by username; one entry per author.
  const profileMap = new Map<string, string>()
  for (const p of posts) {
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

  const tagEntries: MetadataRoute.Sitemap = tags.map((t) => ({
    url: absoluteUrl(`/tag/${t.slug}`),
    lastModified: t.approved_at ?? undefined,
  }))

  return [...staticEntries, ...postEntries, ...profileEntries, ...tagEntries]
}

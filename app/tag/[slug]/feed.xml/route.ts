import { createServerSupabaseClient } from '@/lib/supabase/server'
import { absoluteUrl } from '@/lib/site-url'
import { postUrl, type PostType } from '@/lib/posts/url'
import { renderAtomFeed, type AtomEntry } from '@/lib/atom'

export const dynamic = 'force-dynamic'

const FEED_LIMIT = 50
// Same cap as `app/tag/[slug]/page.tsx` — bounds the `.in('id', [...])`
// second query against a pathological "everything tagged X" tag.
const POST_ID_CAP = 10_000

interface TagRow {
  slug: string
  name: string
  is_approved: boolean
}

interface PostRow {
  title: string
  summary: string
  body_html: string
  type: string
  slug: string
  published_at: string
  edited_at: string | null
  users: {
    username: string
    display_name: string
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: raw } = await params
  const slug = raw.toLowerCase()
  // Canonical-lowercase: 404 mixed-case so the feed has one URL.
  if (raw !== slug) {
    return new Response('Not found', { status: 404 })
  }

  const db = createServerSupabaseClient()

  const { data: tagData } = await db
    .from('tags')
    .select('slug, name, is_approved')
    .eq('slug', slug)
    .maybeSingle()

  const tag = tagData as TagRow | null
  if (!tag || !tag.is_approved) {
    return new Response('Not found', { status: 404 })
  }

  // Mirror `app/tag/[slug]/page.tsx`: post_tags → post IDs → posts.
  const { data: tagPostIdsData } = await db
    .from('post_tags')
    .select('post_id')
    .eq('tag_slug', slug)
    .limit(POST_ID_CAP)

  const postIds = Array.isArray(tagPostIdsData)
    ? Array.from(new Set((tagPostIdsData as Array<{ post_id: string }>).map((r) => r.post_id)))
    : []

  let rows: PostRow[] = []
  if (postIds.length > 0) {
    const { data } = await db
      .from('posts')
      .select(
        'title, summary, body_html, type, slug, published_at, edited_at, users!inner(username, display_name)',
      )
      .in('id', postIds)
      .is('deleted_at', null)
      .order('published_at', { ascending: false })
      .limit(FEED_LIMIT)
    rows = (data ?? []) as unknown as PostRow[]
  }

  const entries: AtomEntry[] = rows.map((p) => {
    const url = absoluteUrl(postUrl(p.users.username, p.type as PostType, p.slug))
    return {
      id: url,
      url,
      title: p.title,
      summary: p.summary,
      contentHtml: p.body_html,
      authorName: p.users.display_name,
      authorHandle: p.users.username,
      published: p.published_at,
      updated: p.edited_at ?? p.published_at,
    }
  })

  const selfUrl = absoluteUrl(`/tag/${tag.slug}/feed.xml`)
  // Stable sentinel for empty feeds so the timestamp doesn't tick every
  // 5 minutes — readers that short-circuit on <updated> would otherwise
  // re-poll forever on a tag with no published posts yet.
  const updated = entries.length > 0 ? entries[0].updated : '1970-01-01T00:00:00Z'

  const xml = renderAtomFeed({
    title: `#${tag.name} — agentlab.in`,
    description: `Posts tagged #${tag.name} on agentlab.in`,
    selfUrl,
    alternateUrl: absoluteUrl(`/tag/${tag.slug}`),
    feedId: selfUrl,
    updated,
    entries,
  })

  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/atom+xml; charset=utf-8',
      'cache-control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  })
}

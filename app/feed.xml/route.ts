import { createServerSupabaseClient } from '@/lib/supabase/server'
import { absoluteUrl } from '@/lib/site-url'
import { postUrl, type PostType } from '@/lib/posts/url'
import { renderAtomFeed, type AtomEntry } from '@/lib/atom'

// Content changes per publish; also keeps Supabase env optional at build time.
export const dynamic = 'force-dynamic'

const FEED_LIMIT = 50
const SITE_DESCRIPTION = 'Community publishing for AI agent infrastructure.'

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

export async function GET() {
  const db = createServerSupabaseClient()

  const { data } = await db
    .from('posts')
    .select(
      'title, summary, body_html, type, slug, published_at, edited_at, users!inner(username, display_name)',
    )
    .is('deleted_at', null)
    .order('published_at', { ascending: false })
    .limit(FEED_LIMIT)

  const rows = (data ?? []) as unknown as PostRow[]

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

  const selfUrl = absoluteUrl('/feed.xml')
  // Stable sentinel for empty feeds so the timestamp doesn't tick every
  // 5 minutes — readers that short-circuit on <updated> would otherwise
  // re-poll forever on a feed with no posts yet.
  const updated = entries.length > 0 ? entries[0].updated : '1970-01-01T00:00:00Z'

  const xml = renderAtomFeed({
    title: 'agentlab.in',
    description: SITE_DESCRIPTION,
    selfUrl,
    alternateUrl: absoluteUrl('/'),
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

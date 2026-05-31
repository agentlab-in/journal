import { createServerSupabaseClient } from '@/lib/supabase/server'
import { absoluteUrl } from '@/lib/site-url'
import { postUrl, type PostType } from '@/lib/posts/url'
import { renderAtomFeed, type AtomEntry } from '@/lib/atom'

export const dynamic = 'force-dynamic'

const FEED_LIMIT = 50

interface UserRow {
  id: string
  username: string
  display_name: string
}

interface PostRow {
  title: string
  summary: string
  body_html: string
  type: string
  slug: string
  published_at: string
  edited_at: string | null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username: raw } = await params
  // Canonical URLs are lowercase. 404 mixed-case so search engines don't
  // index two feeds for the same author.
  if (raw !== raw.toLowerCase()) {
    return new Response('Not found', { status: 404 })
  }
  const username = raw

  const db = createServerSupabaseClient()

  const { data: userData } = await db
    .from('users')
    .select('id, username, display_name')
    .eq('username', username)
    .maybeSingle()

  const user = userData as UserRow | null
  if (!user) {
    return new Response('Not found', { status: 404 })
  }

  const { data: postsData } = await db
    .from('posts')
    .select('title, summary, body_html, type, slug, published_at, edited_at')
    .eq('author_id', user.id)
    .is('deleted_at', null)
    .order('published_at', { ascending: false })
    .limit(FEED_LIMIT)

  const rows = (postsData ?? []) as PostRow[]

  const entries: AtomEntry[] = rows.map((p) => {
    const url = absoluteUrl(postUrl(user.username, p.type as PostType, p.slug))
    return {
      id: url,
      url,
      title: p.title,
      summary: p.summary,
      contentHtml: p.body_html,
      authorName: user.display_name,
      authorHandle: user.username,
      published: p.published_at,
      updated: p.edited_at ?? p.published_at,
    }
  })

  const selfUrl = absoluteUrl(`/${user.username}/feed.xml`)
  // Stable sentinel for empty feeds so the timestamp doesn't tick every
  // 5 minutes — readers that short-circuit on <updated> would otherwise
  // re-poll forever on a user who hasn't published yet.
  const updated = entries.length > 0 ? entries[0].updated : '1970-01-01T00:00:00Z'

  const xml = renderAtomFeed({
    title: `${user.display_name} (@${user.username}) — agentlab.in`,
    description: `Posts by ${user.display_name} on agentlab.in`,
    selfUrl,
    alternateUrl: absoluteUrl(`/${user.username}`),
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

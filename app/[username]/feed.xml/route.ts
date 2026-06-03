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

interface OrgRow {
  id: string
  slug: string
  display_name: string
  deleted_at: string | null
  banned_at: string | null
}

interface PostRow {
  title: string
  summary: string
  body_html: string
  type: string
  slug: string
  published_at: string
  edited_at: string | null
  // Hydrated only on the org branch — used to surface the human author
  // as the entry's <name> in the atom feed.
  author?: {
    username: string
    display_name: string
  } | null
}

interface PostRowWithAuthor extends Omit<PostRow, 'author'> {
  users: {
    username: string
    display_name: string
  } | null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username: raw } = await params
  // Canonical URLs are lowercase. 404 mixed-case so search engines don't
  // index two feeds for the same author / org.
  if (raw !== raw.toLowerCase()) {
    return new Response('Not found', { status: 404 })
  }
  const slug = raw

  const db = createServerSupabaseClient()

  // Resolve the leading segment user-first, org-second — same precedence
  // as the profile page and the post-page lookup.
  const { data: userData } = await db
    .from('users')
    .select('id, username, display_name')
    .eq('username', slug)
    .maybeSingle()

  const user = userData as UserRow | null

  if (user) {
    const { data: postsData } = await db
      .from('posts')
      .select('title, summary, body_html, type, slug, published_at, edited_at')
      .eq('author_id', user.id)
      .is('org_id', null)
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

  // Org branch — slug didn't match a user, try orgs. Soft-deleted /
  // banned orgs 404 to match the profile-page visibility cascade.
  const { data: orgData } = await db
    .from('orgs')
    .select('id, slug, display_name, deleted_at, banned_at')
    .eq('slug', slug)
    .maybeSingle()

  const org = orgData as OrgRow | null
  if (!org || org.deleted_at !== null || org.banned_at !== null) {
    return new Response('Not found', { status: 404 })
  }

  // Org-authored posts. Join the human author so each <entry> can still
  // attribute a name + handle in the atom <author> block — atom feed
  // readers want a person in the author field even when the publisher
  // is an org.
  const { data: postsData } = await db
    .from('posts')
    .select(
      'title, summary, body_html, type, slug, published_at, edited_at, users!inner(username, display_name)',
    )
    .eq('org_id', org.id)
    .is('deleted_at', null)
    .order('published_at', { ascending: false })
    .limit(FEED_LIMIT)

  // Supabase types `!inner` joins as arrays; runtime shape is singular
  // for a 1:1 FK — same cast pattern as lib/posts/lookup.ts.
  const rows = (postsData ?? []) as unknown as PostRowWithAuthor[]

  const entries: AtomEntry[] = rows.map((p) => {
    const url = absoluteUrl(postUrl(org.slug, p.type as PostType, p.slug))
    return {
      id: url,
      url,
      title: p.title,
      summary: p.summary,
      contentHtml: p.body_html,
      // Atom <author> stays a Person — surface the human even when the
      // publisher is the org. Falls back to the org for legacy rows
      // without a joined author (defensive).
      authorName: p.users?.display_name ?? org.display_name,
      authorHandle: p.users?.username ?? org.slug,
      published: p.published_at,
      updated: p.edited_at ?? p.published_at,
    }
  })

  const selfUrl = absoluteUrl(`/${org.slug}/feed.xml`)
  const updated = entries.length > 0 ? entries[0].updated : '1970-01-01T00:00:00Z'

  const xml = renderAtomFeed({
    title: `${org.display_name} (@${org.slug}) — agentlab.in`,
    description: `Posts by ${org.display_name} on agentlab.in`,
    selfUrl,
    alternateUrl: absoluteUrl(`/${org.slug}`),
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

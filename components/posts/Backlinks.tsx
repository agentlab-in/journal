import Link from 'next/link'
import { fetchBacklinks } from '@/lib/posts/backlinks'
import { postUrl } from '@/lib/posts/url'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export interface BacklinksProps {
  postId: string
}

export async function Backlinks({ postId }: BacklinksProps) {
  const links = await fetchBacklinks(createAdminSupabaseClient(), postId)

  if (links.length === 0) {
    return null
  }

  return (
    <section className="backlinks">
      <h2>Referenced by</h2>
      <ul>
        {links.map((l) => (
          <li key={l.id}>
            <Link href={postUrl(l.author_username, l.type, l.slug)}>{l.title}</Link>{' '}
            <span className="backlink-author">@{l.author_username}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

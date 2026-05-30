import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { listUserBookmarks } from '@/lib/bookmarks/list'
import { ProfilePostCard } from '@/components/profile/ProfilePostCard'
import { KeyboardFeedNav } from '@/components/keyboard/KeyboardFeedNav'

export const metadata: Metadata = {
  // Title resolves to `Bookmarks — agentlab.in` via the layout template.
  title: 'Bookmarks',
  robots: { index: false },
}

export default async function BookmarksPage() {
  const session = await getSession()
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/bookmarks')
  }

  const admin = createAdminSupabaseClient()
  const bookmarks = await listUserBookmarks(admin, session.user.id)

  return (
    <main id="main-content" className="profile-follow-page">
      <header className="profile-follow-page__header">
        <h1 className="profile-follow-page__title">Your bookmarks</h1>
      </header>

      {bookmarks.length === 0 ? (
        <p className="profile-follow-page__empty">
          Bookmark posts to revisit them here.
        </p>
      ) : (
        <KeyboardFeedNav>
          <ul className="profile-follow-page__list">
            {bookmarks.map((b) => (
              <li key={b.id}>
                <ProfilePostCard
                  username={b.author.username}
                  post={{
                    id: b.id,
                    type: b.type,
                    slug: b.slug,
                    title: b.title,
                    summary: b.summary,
                    cover_image_url: b.cover_image_url,
                    published_at: b.published_at,
                    view_count: b.view_count,
                    comment_count: b.comment_count,
                    tags: [],
                  }}
                />
              </li>
            ))}
          </ul>
        </KeyboardFeedNav>
      )}
    </main>
  )
}

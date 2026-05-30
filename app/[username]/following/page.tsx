import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { getCachedProfile } from '@/lib/profile/lookup'
import { listFollowEdges } from '@/lib/profile/follow-list'
import { UserCard } from '@/components/profile/UserCard'

interface PageParams {
  username: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>
}): Promise<Metadata> {
  const { username } = await params

  if (username !== username.toLowerCase()) {
    return { title: 'Redirecting…' }
  }

  const profile = await getCachedProfile(username)
  if (!profile) return { title: 'Not found' }

  const title = `People @${profile.username} follows — agentlab.in`
  const description = `Users that ${profile.display_name} follows on agentlab.in`

  return {
    title,
    description,
    alternates: { canonical: `/${profile.username}/following` },
    openGraph: { title, description, url: `/${profile.username}/following` },
  }
}

export default async function FollowingPage({
  params,
}: {
  params: Promise<PageParams>
}) {
  const { username } = await params

  if (username !== username.toLowerCase()) {
    permanentRedirect(`/${username.toLowerCase()}/following`)
  }

  const profile = await getCachedProfile(username)
  if (!profile) notFound()

  const admin = createAdminSupabaseClient()
  const following = await listFollowEdges(admin, profile.id, 'following')

  return (
    <main id="main-content" className="profile-follow-page">
      <header className="profile-follow-page__header">
        <h1 className="profile-follow-page__title">
          {profile.following_count} users{' '}
          <Link href={`/${profile.username}`}>@{profile.username}</Link> follows
        </h1>
      </header>

      {following.length === 0 ? (
        <p className="profile-follow-page__empty">
          @{profile.username} isn&apos;t following anyone yet.
        </p>
      ) : (
        <ul className="profile-follow-page__list">
          {following.map((u) => (
            <li key={u.id}>
              <UserCard
                username={u.username}
                displayName={u.display_name}
                avatarUrl={u.avatar_url}
                bio={u.bio}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

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
    return { title: { absolute: 'Redirecting… — agentlab.in' } }
  }

  const profile = await getCachedProfile(username)
  if (!profile) return { title: { absolute: 'Not found — agentlab.in' } }

  const title = `Followers of @${profile.username} — agentlab.in`
  const description = `People who follow ${profile.display_name} on agentlab.in`

  return {
    // `title.absolute` — we already build the canonical "… — agentlab.in"
    // form here; bypass the layout template so we don't get a double suffix.
    title: { absolute: title },
    description,
    alternates: { canonical: `/${profile.username}/followers` },
    openGraph: { title, description, url: `/${profile.username}/followers` },
  }
}

export default async function FollowersPage({
  params,
}: {
  params: Promise<PageParams>
}) {
  const { username } = await params

  if (username !== username.toLowerCase()) {
    permanentRedirect(`/${username.toLowerCase()}/followers`)
  }

  const profile = await getCachedProfile(username)
  if (!profile) notFound()

  const admin = createAdminSupabaseClient()
  const followers = await listFollowEdges(admin, profile.id, 'followers')

  return (
    <main id="main-content" className="profile-follow-page">
      <header className="profile-follow-page__header">
        <h1 className="profile-follow-page__title">
          {profile.follower_count}{' '}
          {profile.follower_count === 1 ? 'follower' : 'followers'} of{' '}
          <Link href={`/${profile.username}`}>@{profile.username}</Link>
        </h1>
      </header>

      {followers.length === 0 ? (
        <p className="profile-follow-page__empty">
          @{profile.username} doesn&apos;t have any followers yet.
        </p>
      ) : (
        <ul className="profile-follow-page__list">
          {followers.map((u) => (
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

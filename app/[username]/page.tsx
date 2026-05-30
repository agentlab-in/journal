import { notFound, permanentRedirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import {
  createAdminSupabaseClient,
} from '@/lib/supabase/admin'
import { createAnonServerSupabaseClient } from '@/lib/supabase/server'
import {
  getAuthoredPosts,
  getCachedProfile,
  getPinnedPosts,
} from '@/lib/profile/lookup'
import { getFollowState } from '@/lib/profile/follow-state'
import { bioToPlainText, renderBioToHtml } from '@/lib/profile/bio'
import { ProfileHeader } from '@/components/profile/ProfileHeader'
import { PinnedPosts } from '@/components/profile/PinnedPosts'
import { PostList } from '@/components/profile/PostList'

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

  const title = `${profile.display_name} (@${profile.username}) — agentlab.in`
  const description = profile.bio
    ? bioToPlainText(profile.bio)
    : `Profile of ${profile.display_name} on agentlab.in`
  const ogImage = profile.avatar_url ?? '/og.png'

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `/${profile.username}`,
      images: [{ url: ogImage }],
      type: 'profile',
    },
    twitter: {
      card: 'summary',
      title,
      description,
      images: [ogImage],
    },
    alternates: { canonical: `/${profile.username}` },
  }
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<PageParams>
}) {
  const { username } = await params

  // Canonical-lowercase: 308 redirect to the lowercase URL.
  if (username !== username.toLowerCase()) {
    permanentRedirect(`/${username.toLowerCase()}`)
  }

  const profile = await getCachedProfile(username)
  if (!profile) notFound()

  const session = await getSession()
  const viewerId = session?.user?.id ?? null
  const isOwner = viewerId === profile.id
  const isSignedIn = viewerId !== null

  // Share a single anon SSR client across the two list queries. Public reads
  // are gated by RLS public-read policies on users / posts / post_tags /
  // pinned_posts (see supabase/migrations/0002_content.sql).
  const db = createAnonServerSupabaseClient()
  // Follow lookup needs the service-role client — `public.follows` is
  // owner-only-read under RLS, and the NextAuth session has no Supabase JWT.
  const admin = createAdminSupabaseClient()
  const [pinned, authored, bioHtml, initialFollowing] = await Promise.all([
    getPinnedPosts(db, profile.id),
    getAuthoredPosts(db, profile.id),
    profile.bio ? renderBioToHtml(profile.bio) : Promise.resolve<string | null>(null),
    getFollowState({ admin, targetUserId: profile.id, viewerUserId: viewerId }),
  ])

  const pinnedIds = pinned.map((p) => p.id)

  return (
    <main className="profile-page">
      <ProfileHeader
        username={profile.username}
        displayName={profile.display_name}
        avatarUrl={profile.avatar_url}
        bioHtml={bioHtml}
        createdAt={profile.created_at}
        githubLogin={profile.github_login}
        isOwner={isOwner}
        targetUserId={profile.id}
        followerCount={profile.follower_count}
        followingCount={profile.following_count}
        initialFollowing={initialFollowing}
        currentPath={`/${profile.username}`}
        isSignedIn={isSignedIn}
      />

      <PinnedPosts username={profile.username} pins={pinned} isOwner={isOwner} />

      <PostList
        username={profile.username}
        posts={authored}
        isOwner={isOwner}
        initialPinnedIds={pinnedIds}
      />
    </main>
  )
}

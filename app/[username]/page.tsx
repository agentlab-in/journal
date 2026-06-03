import { Suspense } from 'react'
import { notFound, permanentRedirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import {
  createAdminSupabaseClient,
} from '@/lib/supabase/admin'
import { createAnonServerSupabaseClient } from '@/lib/supabase/server'
import {
  getAuthoredPosts,
  getCachedOrg,
  getCachedProfile,
  getOrgPinnedPosts,
  getOrgPosts,
  getPinnedPosts,
} from '@/lib/profile/lookup'
import { getFollowState } from '@/lib/profile/follow-state'
import { bioToPlainText, renderBioToHtml } from '@/lib/profile/bio'
import { organizationJsonLd, personJsonLd } from '@/lib/json-ld'
import { ProfileHeader } from '@/components/profile/ProfileHeader'
import { OrgProfileHeader } from '@/components/profile/OrgProfileHeader'
import { PinnedPosts } from '@/components/profile/PinnedPosts'
import { PostList } from '@/components/profile/PostList'
import { PostCardSkeleton } from '@/components/skeleton/PostCardSkeleton'

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

  // Resolve user first; fall back to org when no user matches the segment.
  const profile = await getCachedProfile(username)
  if (profile) {
    const title = `${profile.display_name} (@${profile.username}) — agentlab.in`
    const description = profile.bio
      ? bioToPlainText(profile.bio)
      : `Profile of ${profile.display_name} on agentlab.in`
    const ogImage = profile.avatar_url ?? '/og.png'

    return {
      // `title.absolute` bypasses the layout-level template — we already
      // built the canonical "… — agentlab.in" form above and don't want
      // a second suffix.
      title: { absolute: title },
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

  const org = await getCachedOrg(username)
  if (!org) return { title: { absolute: 'Not found — agentlab.in' } }

  const orgTitle = `${org.display_name} (@${org.slug}) — agentlab.in`
  const orgDescription = org.bio
    ? bioToPlainText(org.bio)
    : `${org.display_name} on agentlab.in`
  const orgOgImage = org.avatar_url ?? '/og.png'
  return {
    title: { absolute: orgTitle },
    description: orgDescription,
    openGraph: {
      title: orgTitle,
      description: orgDescription,
      url: `/${org.slug}`,
      images: [{ url: orgOgImage }],
      type: 'profile',
    },
    twitter: {
      card: 'summary',
      title: orgTitle,
      description: orgDescription,
      images: [orgOgImage],
    },
    alternates: { canonical: `/${org.slug}` },
  }
}

interface ProfileBodyProps {
  profileId: string
  username: string
  isOwner: boolean
}

/**
 * Slow async boundary — pinned posts + authored posts list. The two
 * queries are kicked off in parallel. Extracted from the page so the
 * `<ProfileHeader />` (which is hydrated from a `cache`-wrapped lookup
 * already awaited by the page) paints instantly while the post lists
 * stream in.
 */
async function ProfileBody({ profileId, username, isOwner }: ProfileBodyProps) {
  const db = createAnonServerSupabaseClient()
  const [pinned, authored] = await Promise.all([
    getPinnedPosts(db, profileId),
    getAuthoredPosts(db, profileId),
  ])
  const pinnedIds = pinned.map((p) => p.id)

  return (
    <>
      <PinnedPosts username={username} pins={pinned} isOwner={isOwner} />
      <PostList
        username={username}
        posts={authored}
        isOwner={isOwner}
        initialPinnedIds={pinnedIds}
      />
    </>
  )
}

interface OrgBodyProps {
  orgId: string
  slug: string
}

/**
 * Org variant of ProfileBody. Posts are queried by org_id, pins by org_id.
 * No "isOwner" affordances — org-member edit surfaces live in
 * /settings/orgs/[slug] (T5), not on the public profile.
 */
async function OrgBody({ orgId, slug }: OrgBodyProps) {
  const db = createAnonServerSupabaseClient()
  const [pinned, authored] = await Promise.all([
    getOrgPinnedPosts(db, orgId),
    getOrgPosts(db, orgId),
  ])
  const pinnedIds = pinned.map((p) => p.id)

  return (
    <>
      <PinnedPosts username={slug} pins={pinned} isOwner={false} />
      <PostList
        username={slug}
        posts={authored}
        isOwner={false}
        initialPinnedIds={pinnedIds}
      />
    </>
  )
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

  if (profile) {
    const session = await getSession()
    const viewerId = session?.user?.id ?? null
    const isOwner = viewerId === profile.id
    const isSignedIn = viewerId !== null

    // Follow lookup needs the service-role client — `public.follows` is
    // owner-only-read under RLS, and the NextAuth session has no Supabase JWT.
    // Run header-blocking awaits in parallel: bio markdown rendering +
    // follow state. Both are needed for `<ProfileHeader />`.
    const admin = createAdminSupabaseClient()
    const [bioHtml, initialFollowing] = await Promise.all([
      profile.bio ? renderBioToHtml(profile.bio) : Promise.resolve<string | null>(null),
      getFollowState({ admin, targetUserId: profile.id, viewerUserId: viewerId }),
    ])

    // Person JSON-LD off the already-fetched profile — emitted before
    // <ProfileHeader> so it lands at the top of the SSR document. `bio`
    // gets passed through `bioToPlainText` (160-char default with ellipsis)
    // so the description is plain text, not markdown.
    const jsonLd = personJsonLd({
      username: profile.username,
      displayName: profile.display_name,
      bio: profile.bio ? bioToPlainText(profile.bio, 160) : null,
      avatarUrl: profile.avatar_url,
      githubLogin: profile.github_login,
    })

    return (
      <main id="main-content" className="profile-page">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd }}
        />
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

        {/* Pinned + authored posts are the slow path on this page —
            PinnedPosts queries `pinned_posts` joined to `posts`, and
            PostList paginates `posts` for this author. Stream both in
            under a Suspense fallback so the header paints first. */}
        <Suspense fallback={<PostCardSkeleton count={4} />}>
          <ProfileBody
            profileId={profile.id}
            username={profile.username}
            isOwner={isOwner}
          />
        </Suspense>
      </main>
    )
  }

  // Org branch — slug didn't match a user, try orgs by slug. Soft-deleted
  // and banned orgs are filtered inside getCachedOrg.
  const org = await getCachedOrg(username)
  if (!org) notFound()

  const bioHtml = org.bio ? await renderBioToHtml(org.bio) : null

  const jsonLd = organizationJsonLd({
    slug: org.slug,
    displayName: org.display_name,
    bio: org.bio ? bioToPlainText(org.bio, 160) : null,
    avatarUrl: org.avatar_url,
  })

  return (
    <main id="main-content" className="profile-page profile-page--org">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <OrgProfileHeader
        slug={org.slug}
        displayName={org.display_name}
        avatarUrl={org.avatar_url}
        coverImageUrl={org.cover_image_url}
        bioHtml={bioHtml}
        createdAt={org.created_at}
      />

      <Suspense fallback={<PostCardSkeleton count={4} />}>
        <OrgBody orgId={org.id} slug={org.slug} />
      </Suspense>
    </main>
  )
}

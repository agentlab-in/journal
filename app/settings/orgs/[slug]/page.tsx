/**
 * /settings/orgs/[slug] — admin-only org settings page.
 *
 * Server-component shell. Gates on session, resolves the org (404 if
 * missing/deleted/banned), then checks the caller is an admin via the
 * boolean isOrgAdmin helper. Non-admins 404 — mirrors the existence-leak
 * posture used elsewhere (e.g. /write/[postId] for non-owners).
 *
 * Renders three client components: profile form, members panel, danger
 * zone. Each one talks to /api/orgs/* directly.
 */
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { getOrgBySlug, isOrgAdmin } from '@/lib/orgs/auth'
import { OrgProfileForm } from '@/components/settings/orgs/OrgProfileForm'
import {
  OrgMembersPanel,
  type OrgMember,
} from '@/components/settings/orgs/OrgMembersPanel'
import { OrgDangerZone } from '@/components/settings/orgs/OrgDangerZone'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Org settings',
  robots: { index: false, follow: false },
}

interface MemberJoinRow {
  user_id: string
  role: 'admin' | 'member'
  users: {
    id: string
    username: string
    display_name: string | null
    avatar_url: string | null
  } | null
}

export default async function OrgSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const session = await getSession()
  if (!session?.user?.id) {
    redirect(`/auth/signin?callbackUrl=/settings/orgs/${slug}`)
  }
  const callerUserId = session.user.id

  const supabase = createAdminSupabaseClient()
  const org = await getOrgBySlug(supabase, slug)
  if (!org) notFound()

  const admin = await isOrgAdmin(supabase, org.id, callerUserId)
  if (!admin) notFound()

  const { data: memberRows } = await supabase
    .from('org_members')
    .select(
      'user_id, role, users!inner(id, username, display_name, avatar_url)',
    )
    .eq('org_id', org.id)

  const members: OrgMember[] = []
  for (const r of (memberRows ?? []) as unknown as MemberJoinRow[]) {
    if (!r.users) continue
    members.push({
      user_id: r.user_id,
      username: r.users.username,
      display_name: r.users.display_name ?? r.users.username,
      avatar_url: r.users.avatar_url,
      role: r.role,
    })
  }
  // Admins first, then members; secondary sort by username.
  members.sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1
    return a.username.localeCompare(b.username)
  })

  return (
    <main id="main-content" className="settings-page">
      <h1 className="settings-heading">
        {org.display_name} <span className="settings-handle">@{org.slug}</span>
      </h1>

      <OrgProfileForm
        slug={org.slug}
        initialDisplayName={org.display_name}
        initialBio={org.bio}
        initialAvatarUrl={org.avatar_url}
        initialCoverImageUrl={org.cover_image_url}
      />

      <OrgMembersPanel
        slug={org.slug}
        callerUserId={callerUserId}
        initialMembers={members}
      />

      <OrgDangerZone slug={org.slug} displayName={org.display_name} />
    </main>
  )
}

import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { requireConsentOrRedirect } from '@/lib/consent/require-consent'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { ProfileSettingsForm } from '@/components/profile/ProfileSettingsForm'
import { DeleteAccountSection } from '@/components/profile/DeleteAccountSection'
import {
  OrgsListSection,
  type OrgListEntry,
} from '@/components/settings/OrgsListSection'
import { ConsentSnapshotSection } from '@/components/settings/ConsentSnapshotSection'

export const metadata: Metadata = {
  // Title resolves to `Profile settings — agentlab.in` via the layout template.
  title: 'Profile settings',
  robots: { index: false, follow: false },
}

interface UserRow {
  username: string
  display_name: string
  bio: string | null
  avatar_url: string | null
}

interface OrgMembershipRow {
  orgs: {
    id: string
    slug: string
    display_name: string
    deleted_at: string | null
    banned_at: string | null
  } | null
}

export default async function ProfileSettingsPage() {
  const session = await getSession()
  if (!session?.user?.id) {
    redirect('/auth/signin')
  }
  await requireConsentOrRedirect(session.user.id)

  const admin = createAdminSupabaseClient()
  const { data } = await admin
    .from('users')
    .select('username, display_name, bio, avatar_url')
    .eq('id', session.user.id)
    .single()

  // Session passed the auth gate, but the corresponding public.users row is
  // missing (or the SELECT errored — `data` is null in either case). That's a
  // genuinely-not-found state for this resource; surfacing an empty form
  // would silently hide the real problem and render a broken `@` handle.
  if (data == null) {
    notFound()
  }

  const row = data as UserRow

  const { data: consentRow } = await admin
    .from('consents')
    .select('consented_at, terms_version, content_policy_version, privacy_policy_version')
    .eq('user_id', session.user.id)
    .order('consented_at', { ascending: false })
    .limit(1)
    .maybeSingle<{
      consented_at: string
      terms_version: string
      content_policy_version: string
      privacy_policy_version: string
    }>()

  // Fetch the caller's orgs for the "Your orgs" section. Same join+filter
  // shape as the /write page so we exclude soft-deleted/banned orgs.
  const { data: memberRows } = await admin
    .from('org_members')
    .select('orgs!inner(id, slug, display_name, deleted_at, banned_at)')
    .eq('user_id', session.user.id)

  const orgs: OrgListEntry[] = []
  for (const r of (memberRows ?? []) as unknown as OrgMembershipRow[]) {
    if (!r.orgs) continue
    if (r.orgs.deleted_at !== null || r.orgs.banned_at !== null) continue
    orgs.push({
      id: r.orgs.id,
      slug: r.orgs.slug,
      display_name: r.orgs.display_name,
    })
  }
  orgs.sort((a, b) => a.display_name.localeCompare(b.display_name))

  return (
    <main id="main-content" className="settings-page settings-page--wide">
      <h1 className="settings-heading">Profile settings</h1>
      <ProfileSettingsForm
        username={row.username}
        displayName={row.display_name}
        bio={row.bio}
        avatarUrl={row.avatar_url}
      />
      <OrgsListSection orgs={orgs} />
      <ConsentSnapshotSection consent={consentRow ?? null} />
      <DeleteAccountSection />
    </main>
  )
}

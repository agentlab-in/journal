import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { ProfileSettingsForm } from '@/components/profile/ProfileSettingsForm'

export const metadata: Metadata = {
  title: 'Profile settings — agentlab.in',
  robots: { index: false, follow: false },
}

interface UserRow {
  username: string
  display_name: string
  bio: string | null
  avatar_url: string | null
}

export default async function ProfileSettingsPage() {
  const session = await getSession()
  if (!session?.user?.id) {
    redirect('/auth/signin')
  }

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

  return (
    <main className="settings-page">
      <h1 className="settings-heading">Profile settings</h1>
      <ProfileSettingsForm
        username={row.username}
        displayName={row.display_name}
        bio={row.bio}
        avatarUrl={row.avatar_url}
      />
    </main>
  )
}

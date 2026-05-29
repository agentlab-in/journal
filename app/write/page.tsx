/**
 * /write — new-post editor.
 *
 * Server component. Gates on a valid NextAuth session and looks up the
 * canonical username from public.users so the EditorShell can render the
 * slug preview and PublishAs label. A missing username falls through to a
 * sentinel — see EditorShell — but should never happen in practice because
 * Phase 1.1's auth-audit populator inserts the public.users row on first
 * login.
 */
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { EditorShell } from '@/components/editor/EditorShell'

// The editor is a thick client component; rendering the server shell as
// a dynamic route saves us from caching draft-bearing markup.
export const dynamic = 'force-dynamic'

export default async function WritePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/write')
  }

  const supabase = createAdminSupabaseClient()
  const { data: user } = await supabase
    .from('users')
    .select('username')
    .eq('id', session.user.id)
    .maybeSingle<{ username: string }>()

  // If the user row is missing (sync hasn't run yet), the editor still
  // renders — the slug preview will read `unknown` until they sign in
  // again and the trigger fires. We choose not to hard-fail because the
  // author can still draft locally.
  const username = user?.username ?? ''

  return <EditorShell mode="new" currentUsername={username} />
}

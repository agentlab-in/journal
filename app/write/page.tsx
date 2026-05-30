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
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { ensurePublicUser } from '@/lib/users/ensure-public-user'
import { EditorShell } from '@/components/editor/EditorShell'

// The editor is a thick client component; rendering the server shell as
// a dynamic route saves us from caching draft-bearing markup.
export const dynamic = 'force-dynamic'

export default async function WritePage() {
  const session = await getSession()
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/write')
  }

  const supabase = createAdminSupabaseClient()
  const username = (await ensurePublicUser(supabase, session.user.id)) ?? ''

  // E2E hook: when E2E_AUTOSAVE_MS is set in the environment (e.g. by
  // playwright.config.ts via the webServer env block) we forward it to the
  // editor shell so the draft auto-save debounce uses a small value. In
  // production this var is unset and DraftManager uses its 30s default.
  const autoSaveMsRaw = process.env.E2E_AUTOSAVE_MS
  const autoSaveMs = autoSaveMsRaw ? Number.parseInt(autoSaveMsRaw, 10) : undefined
  const autoSaveMsProp =
    autoSaveMs !== undefined && Number.isFinite(autoSaveMs) && autoSaveMs > 0
      ? autoSaveMs
      : undefined

  return (
    <main className="flex flex-1 flex-col">
      <EditorShell
        mode="new"
        currentUsername={username}
        autoSaveMs={autoSaveMsProp}
      />
    </main>
  )
}

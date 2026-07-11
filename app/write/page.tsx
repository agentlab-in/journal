/**
 * /write — new-post editor.
 *
 * Server component. Gates on a valid NextAuth session and looks up the
 * canonical username from public.users so the EditorShell can render the
 * slug preview and PublishAs label. A missing username falls through to a
 * sentinel — see EditorShell — but should never happen in practice because
 * Phase 1.1's auth-audit populator inserts the public.users row on first
 * login.
 *
 * Phase 11 / T5: also fetches the caller's orgs (admin OR member) so the
 * editor's PublishAsSelect can render them. Soft-deleted / banned orgs are
 * excluded — RLS would hide them anyway but we filter here too for clarity.
 */
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { ensurePublicUser } from '@/lib/users/ensure-public-user'
import { EditorShell } from '@/components/editor/EditorShell'
import type { PublishAsOrgOption } from '@/components/editor/PublishAsSelect'

// The editor is a thick client component; rendering the server shell as
// a dynamic route saves us from caching draft-bearing markup.
export const dynamic = 'force-dynamic'

// Title resolves to `Write — agentlab.in` via the layout template.
export const metadata: Metadata = {
  title: 'Write',
  robots: { index: false },
}

interface OrgMembershipRow {
  org_id: string
  orgs: {
    id: string
    slug: string
    display_name: string
    deleted_at: string | null
    banned_at: string | null
  } | null
}

export default async function WritePage() {
  const session = await getSession()
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/write')
  }
  const supabase = createAdminSupabaseClient()
  const username = (await ensurePublicUser(supabase, session.user.id)) ?? ''

  // Fetch the caller's orgs. Both admin and member roles can publish under
  // the org (the publish route only checks org membership, not role) so we
  // don't filter by role here.
  const { data: memberRows } = await supabase
    .from('org_members')
    .select('org_id, orgs!inner(id, slug, display_name, deleted_at, banned_at)')
    .eq('user_id', session.user.id)

  const userOrgs: PublishAsOrgOption[] = []
  for (const r of (memberRows ?? []) as unknown as OrgMembershipRow[]) {
    if (!r.orgs) continue
    if (r.orgs.deleted_at !== null || r.orgs.banned_at !== null) continue
    userOrgs.push({
      id: r.orgs.id,
      slug: r.orgs.slug,
      display_name: r.orgs.display_name,
    })
  }
  // Stable order — display_name asc — so the picker doesn't flicker between
  // renders just because Postgres reordered the join.
  userOrgs.sort((a, b) => a.display_name.localeCompare(b.display_name))

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
    <main id="main-content" className="flex flex-1 flex-col">
      <EditorShell
        mode="new"
        currentUsername={username}
        userOrgs={userOrgs}
        autoSaveMs={autoSaveMsProp}
      />
    </main>
  )
}

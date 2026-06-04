/**
 * /write/[postId] — edit-mode for an existing post.
 *
 * Server component. Gates on a valid session, then verifies the post
 * exists AND is authored by the current user (404 otherwise — we don't
 * leak the existence of someone else's post via a 403). Joins
 * post_tags + tags so the editor pre-fills the TagPicker with the
 * post's current selection.
 *
 * Next 16 routing: `params` arrives as a Promise — see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md.
 */
import { redirect, notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { ensurePublicUser } from '@/lib/users/ensure-public-user'
import { EditorShell, type InitialPost } from '@/components/editor/EditorShell'
import type { PublishAsOrgOption } from '@/components/editor/PublishAsSelect'
import type { TagOption } from '@/components/editor/TagPicker'
import type { DraftType } from '@/lib/drafts'

export const dynamic = 'force-dynamic'

// Title resolves to `Edit post — agentlab.in` via the layout template.
// We don't fetch the post title for the document title because this
// route is no-index anyway and the editor body shows the title inline.
export const metadata: Metadata = {
  title: 'Edit post',
  robots: { index: false },
}

interface PostRow {
  id: string
  author_id: string
  org_id: string | null
  title: string
  summary: string
  type: DraftType
  body_md: string
  cover_image_url: string | null
  structured_sections: Record<string, string> | null
  edited_at: string | null
  published_at: string
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

interface TagJoinRow {
  tag_slug: string
  tags: {
    slug: string
    name: string
    parent_tag_slug: string | null
  } | null
}

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ postId: string }>
}) {
  const { postId } = await params

  const session = await getSession()
  if (!session?.user?.id) {
    redirect(`/auth/signin?callbackUrl=/write/${postId}`)
  }

  const supabase = createAdminSupabaseClient()

  // Fetch the post + ownership in one shot.
  const { data: post } = await supabase
    .from('posts')
    .select(
      'id, author_id, org_id, title, summary, type, body_md, cover_image_url, structured_sections, edited_at, published_at',
    )
    .eq('id', postId)
    .maybeSingle<PostRow>()

  if (!post || post.author_id !== session.user.id) {
    // 404 — collapses "doesn't exist" and "not yours" so we don't leak
    // existence to non-authors.
    notFound()
  }

  // Username for the slug preview. Self-heals public.users if the row
  // is missing (e.g. user signed up before Phase 1.1's populator).
  const username = (await ensurePublicUser(supabase, session.user.id)) ?? ''

  // Tags currently attached to this post.
  const { data: joinRows } = await supabase
    .from('post_tags')
    .select('tag_slug, tags ( slug, name, parent_tag_slug )')
    .eq('post_id', postId)
    .returns<TagJoinRow[]>()

  const initialTags: TagOption[] = (joinRows ?? [])
    .map((row) => row.tags)
    .filter((t): t is NonNullable<TagJoinRow['tags']> => t !== null)
    .map((t) => ({
      slug: t.slug,
      name: t.name,
      parent_tag_slug: t.parent_tag_slug,
    }))

  const initialPost: InitialPost = {
    id: post.id,
    title: post.title,
    summary: post.summary,
    type: post.type,
    body_md: post.body_md,
    cover_image_url: post.cover_image_url,
    structured_sections: post.structured_sections,
    edited_at: post.edited_at,
    published_at: post.published_at,
    org_id: post.org_id,
  }

  // Fetch user's orgs so the PublishAsSelect can render the org label even
  // in edit mode (it's disabled but should still show the current org by
  // display_name rather than just the raw UUID).
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
  userOrgs.sort((a, b) => a.display_name.localeCompare(b.display_name))

  return (
    <main id="main-content" className="flex flex-1 flex-col">
      <EditorShell
        mode="edit"
        editPostId={postId}
        currentUsername={username}
        initialPost={initialPost}
        initialTags={initialTags}
        userOrgs={userOrgs}
      />
    </main>
  )
}

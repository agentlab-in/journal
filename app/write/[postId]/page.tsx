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
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { ensurePublicUser } from '@/lib/users/ensure-public-user'
import { EditorShell, type InitialPost } from '@/components/editor/EditorShell'
import type { TagOption } from '@/components/editor/TagPicker'
import type { DraftType } from '@/lib/drafts'

export const dynamic = 'force-dynamic'

interface PostRow {
  id: string
  author_id: string
  title: string
  summary: string
  type: DraftType
  body_md: string
  cover_image_url: string | null
  structured_sections: Record<string, string> | null
  edited_at: string | null
  published_at: string
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
      'id, author_id, title, summary, type, body_md, cover_image_url, structured_sections, edited_at, published_at',
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
  }

  return (
    <main className="flex flex-1 flex-col">
      <EditorShell
        mode="edit"
        editPostId={postId}
        currentUsername={username}
        initialPost={initialPost}
        initialTags={initialTags}
      />
    </main>
  )
}

import Link from 'next/link'
import { getSession, resolveIsAdmin } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { CommentThread } from './CommentThread'
import type { ThreadComment } from './CommentThread'

export interface CommentsSectionProps {
  postId: string
}

interface RawCommentRow {
  id: string
  post_id: string
  parent_comment_id: string | null
  body: string
  author_id: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  deletion_reason: 'author' | 'moderation' | null
  // PostgREST embed: the FK from comments.author_id to public.users.id
  // resolves to a single row, so the joined column is an object (or null
  // if the parent row was hard-deleted, which "ON DELETE RESTRICT" should
  // prevent — kept nullable for defensiveness).
  users: {
    username: string
    display_name: string
    avatar_url: string | null
  } | null
}

export async function CommentsSection({ postId }: CommentsSectionProps) {
  // Service-role read so soft-deleted rows come back too. Public RLS
  // hides them, but we need them to render the "[removed]" placeholder
  // and keep replies anchored to their original parent.
  const admin = createAdminSupabaseClient()
  const { data, error } = await admin
    .from('comments')
    .select(
      'id, post_id, parent_comment_id, body, author_id, created_at, edited_at, deleted_at, deletion_reason, users:author_id(username, display_name, avatar_url)',
    )
    .eq('post_id', postId)
    .order('created_at', { ascending: true })

  // On a transient DB error we still want the page to render — just
  // without comments. Logging keeps it diagnosable.
  if (error) {
    console.error('[comments] fetch failed:', error.message)
  }

  const rows = ((data ?? []) as unknown as RawCommentRow[]).map(
    (r): ThreadComment => ({
      id: r.id,
      post_id: r.post_id,
      parent_comment_id: r.parent_comment_id,
      body: r.body,
      author_id: r.author_id,
      created_at: r.created_at,
      edited_at: r.edited_at,
      deleted_at: r.deleted_at,
      deletion_reason: r.deletion_reason,
      author: r.users
        ? {
            username: r.users.username,
            display_name: r.users.display_name,
            avatar_url: r.users.avatar_url,
          }
        : null,
    }),
  )

  // The visible-to-public count = posts.comment_count (set by trigger).
  // Recomputing it here from the same row set keeps the heading and the
  // post-meta counter in sync even between the trigger fire and a stale
  // cached posts row.
  const visibleCount = rows.filter((r) => r.deleted_at == null).length

  const session = await getSession()
  const currentUserId = session?.user?.id ?? null
  const isAdminUser =
    currentUserId != null ? await resolveIsAdmin(currentUserId) : false

  if (rows.length === 0) {
    return (
      <section
        className="comments-section"
        aria-labelledby="comments-heading"
      >
        <h2 id="comments-heading">Comments</h2>
        {currentUserId ? (
          <>
            <p className="comments-section__empty">Be the first to comment.</p>
            <CommentThread
              initialComments={[]}
              currentUserId={currentUserId}
              isAdmin={isAdminUser}
              postId={postId}
            />
          </>
        ) : (
          <>
            <p className="comments-section__empty">Be the first to comment.</p>
            <p className="comments-section__signin">
              <Link href="/auth/signin">Sign in</Link> to comment.
            </p>
          </>
        )}
      </section>
    )
  }

  return (
    <section className="comments-section" aria-labelledby="comments-heading">
      <h2 id="comments-heading">
        {visibleCount} {visibleCount === 1 ? 'Comment' : 'Comments'}
      </h2>
      <CommentThread
        initialComments={rows}
        currentUserId={currentUserId}
        isAdmin={isAdminUser}
        postId={postId}
      />
    </section>
  )
}

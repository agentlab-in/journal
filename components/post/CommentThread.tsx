'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { buildCommentTree } from '@/lib/comments/tree'
import type { TreeNode } from '@/lib/comments/tree'
import { formatRelativeTime } from '@/lib/comments/format-time'
import { CommentForm } from './CommentForm'
import type {
  CommentFormCreatedResult,
  CommentFormEditedResult,
} from './CommentForm'

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000

export interface ThreadAuthor {
  username: string
  display_name: string
  avatar_url: string | null
}

export interface ThreadComment {
  id: string
  post_id: string
  parent_comment_id: string | null
  body: string
  author_id: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  deletion_reason: 'author' | 'moderation' | null
  author: ThreadAuthor | null
  [key: string]: unknown
}

export interface CommentThreadProps {
  initialComments: ThreadComment[]
  currentUserId: string | null
  isAdmin: boolean
  postId: string
  // Inject `now` for deterministic tests of the 24h edit window.
  nowMs?: number
}

export function CommentThread({
  initialComments,
  currentUserId,
  isAdmin,
  postId,
  nowMs,
}: CommentThreadProps) {
  const [comments, setComments] = useState<ThreadComment[]>(initialComments)

  // Pin "now" to the time of mount (or to the injected value) so render
  // is a pure function of state. We refresh roughly every 30s for the
  // relative-time string + edit-window calculation; that's coarse enough
  // for "Edit" to disappear shortly after 24h without thrashing the tree.
  const [renderNow, setRenderNow] = useState<number>(() => nowMs ?? Date.now())
  useEffect(() => {
    if (nowMs != null) return
    const id = setInterval(() => setRenderNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [nowMs])

  const tree = useMemo(() => buildCommentTree(comments), [comments])

  const handleCreated = (result: CommentFormCreatedResult) => {
    // The API returns just the inserted row; the form below the post is
    // for top-level comments. Attach a thin author shell from the session
    // so the optimistic render shows something useful; the next page
    // load picks up the real joined row.
    const optimistic: ThreadComment = {
      id: result.id,
      post_id: result.post_id,
      parent_comment_id: result.parent_comment_id,
      body: result.body,
      author_id: result.author_id,
      created_at: result.created_at,
      edited_at: null,
      deleted_at: null,
      deletion_reason: null,
      // Author is unknown to the client; the recursive renderer falls
      // back to "you" when author is null AND author_id matches the
      // current user, otherwise to a neutral placeholder.
      author: null,
    }
    setComments((curr) => [...curr, optimistic])
  }

  const handleEdited = (result: CommentFormEditedResult) => {
    setComments((curr) =>
      curr.map((c) =>
        c.id === result.id
          ? { ...c, body: result.body, edited_at: result.edited_at }
          : c,
      ),
    )
  }

  const handleDeleted = (id: string, reason: 'author' | 'moderation') => {
    setComments((curr) =>
      curr.map((c) =>
        c.id === id
          ? {
              ...c,
              deleted_at: new Date().toISOString(),
              deletion_reason: reason,
            }
          : c,
      ),
    )
  }

  return (
    <div className="comment-thread">
      {currentUserId && (
        <div className="comment-thread__root-form">
          <CommentForm
            postId={postId}
            mode="create"
            onSuccess={(r) => handleCreated(r as CommentFormCreatedResult)}
          />
        </div>
      )}

      {tree.length === 0 ? null : (
        <ul className="comment-thread__list">
          {tree.map((node) => (
            <CommentNode
              key={node.comment.id}
              node={node}
              postId={postId}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              nowMs={renderNow}
              onCreated={handleCreated}
              onEdited={handleEdited}
              onDeleted={handleDeleted}
            />
          ))}
        </ul>
      )}

      {!currentUserId && (
        <p className="comment-thread__signin">
          Sign in to comment. <Link href="/auth/signin">Sign in</Link>
        </p>
      )}
    </div>
  )
}

interface CommentNodeProps {
  node: TreeNode<ThreadComment>
  postId: string
  currentUserId: string | null
  isAdmin: boolean
  nowMs: number
  onCreated: (r: CommentFormCreatedResult) => void
  onEdited: (r: CommentFormEditedResult) => void
  onDeleted: (id: string, reason: 'author' | 'moderation') => void
}

function CommentNode({
  node,
  postId,
  currentUserId,
  isAdmin,
  nowMs,
  onCreated,
  onEdited,
  onDeleted,
}: CommentNodeProps) {
  const [replying, setReplying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const c = node.comment
  const isDeleted = c.deleted_at != null
  const isAuthor = currentUserId != null && currentUserId === c.author_id

  const withinEditWindow =
    nowMs - new Date(c.created_at).getTime() < EDIT_WINDOW_MS

  async function handleDelete() {
    if (deleting) return
    if (!window.confirm('Delete this comment? It will be marked as removed.')) {
      return
    }
    setDeleting(true)
    try {
      const res = await fetch(`/api/comments/${c.id}`, { method: 'DELETE' })
      if (!res.ok) {
        window.alert(`Delete failed (${res.status}).`)
        setDeleting(false)
        return
      }
      const data = (await res.json()) as {
        ok: boolean
        deletion_reason: 'author' | 'moderation'
      }
      onDeleted(c.id, data.deletion_reason)
    } catch {
      window.alert('Delete failed.')
      setDeleting(false)
    }
  }

  const authorHandle =
    c.author?.username ??
    (isAuthor ? 'you' : 'unknown')

  return (
    <li
      className="comment"
      data-comment-id={c.id}
      data-depth={node.depth}
    >
      <div className="comment__header">
        {c.author?.avatar_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.author.avatar_url}
            alt=""
            className="comment__avatar"
          />
        )}
        {c.author?.username ? (
          <Link
            href={`/${c.author.username}`}
            className="comment__author"
          >
            @{c.author.username}
          </Link>
        ) : (
          <span className="comment__author">@{authorHandle}</span>
        )}
        <span className="comment__time">{formatRelativeTime(c.created_at)}</span>
        {c.edited_at && !isDeleted && (
          <span className="comment__edited" aria-label="Edited"> (edited)</span>
        )}
      </div>

      {isDeleted ? (
        <p className="comment__body comment__body--removed">
          <em>
            [removed by{' '}
            {c.deletion_reason === 'author' ? 'author' : 'moderator'}]
          </em>
        </p>
      ) : editing ? (
        <CommentForm
          postId={postId}
          mode="edit"
          commentId={c.id}
          initialBody={c.body}
          autoFocus
          onSuccess={(r) => {
            onEdited(r as CommentFormEditedResult)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="comment__body">{c.body}</p>
      )}

      {!isDeleted && !editing && (
        <div className="comment__actions">
          {currentUserId && (
            <button
              type="button"
              className="comment__action"
              onClick={() => setReplying((r) => !r)}
              aria-expanded={replying}
            >
              {replying ? 'Cancel reply' : 'Reply'}
            </button>
          )}
          {isAuthor && withinEditWindow && (
            <button
              type="button"
              className="comment__action"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          )}
          {(isAuthor || isAdmin) && (
            <button
              type="button"
              className="comment__action comment__action--delete"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>
      )}

      {replying && !isDeleted && (
        <div className="comment__reply-form">
          <CommentForm
            postId={postId}
            parentCommentId={c.id}
            mode="create"
            autoFocus
            onSuccess={(r) => {
              onCreated(r as CommentFormCreatedResult)
              setReplying(false)
            }}
            onCancel={() => setReplying(false)}
          />
        </div>
      )}

      {node.children.length > 0 && (
        <ul className="comment__children">
          {node.children.map((child) => (
            <CommentNode
              key={child.comment.id}
              node={child}
              postId={postId}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              nowMs={nowMs}
              onCreated={onCreated}
              onEdited={onEdited}
              onDeleted={onDeleted}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

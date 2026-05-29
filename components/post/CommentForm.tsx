'use client'

import { useEffect, useRef, useState } from 'react'

const MAX_LEN = 5000

export interface CommentFormCreatedResult {
  id: string
  post_id: string
  parent_comment_id: string | null
  body: string
  author_id: string
  created_at: string
}

export interface CommentFormEditedResult {
  id: string
  body: string
  edited_at: string
}

export type CommentFormResult = CommentFormCreatedResult | CommentFormEditedResult

export interface CommentFormProps {
  postId: string
  parentCommentId?: string | null
  initialBody?: string
  mode: 'create' | 'edit'
  commentId?: string
  onSuccess: (result: CommentFormResult) => void
  onCancel?: () => void
  autoFocus?: boolean
}

export function CommentForm({
  postId,
  parentCommentId = null,
  initialBody = '',
  mode,
  commentId,
  onSuccess,
  onCancel,
  autoFocus = false,
}: CommentFormProps) {
  const [body, setBody] = useState(initialBody)
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [autoFocus])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    const trimmed = body.trim()
    if (trimmed.length === 0) return

    setSubmitting(true)
    try {
      let res: Response
      if (mode === 'create') {
        res = await fetch('/api/comments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            post_id: postId,
            parent_comment_id: parentCommentId,
            body: trimmed,
          }),
        })
      } else {
        if (!commentId) {
          window.alert('Missing commentId for edit')
          return
        }
        res = await fetch(`/api/comments/${commentId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: trimmed }),
        })
      }

      if (!res.ok) {
        const msg = await readErrorMessage(res)
        window.alert(msg)
        return
      }

      const data = (await res.json()) as CommentFormResult
      onSuccess(data)
      if (mode === 'create') {
        setBody('')
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Comment failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const remaining = body.length
  const overLimit = remaining > MAX_LEN

  return (
    <form className="comment-form" onSubmit={handleSubmit}>
      <textarea
        ref={textareaRef}
        className="comment-form__textarea"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={MAX_LEN}
        placeholder={
          mode === 'create'
            ? parentCommentId
              ? 'Write a reply…'
              : 'Add a comment…'
            : undefined
        }
        disabled={submitting}
        aria-label={mode === 'create' ? 'Comment body' : 'Edit comment body'}
      />
      <div className="comment-form__footer">
        <span
          className={
            overLimit
              ? 'comment-form__counter comment-form__counter--over'
              : 'comment-form__counter'
          }
          aria-live="polite"
        >
          {remaining}/{MAX_LEN}
        </span>
        <div className="comment-form__actions">
          {onCancel && (
            <button
              type="button"
              className="comment-form__cancel"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="comment-form__submit"
            disabled={submitting || body.trim().length === 0 || overLimit}
          >
            {submitting
              ? mode === 'edit'
                ? 'Saving…'
                : 'Posting…'
              : mode === 'edit'
                ? 'Save'
                : 'Post'}
          </button>
        </div>
      </div>
    </form>
  )
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string }
    if (j.error) return `Comment failed: ${j.error}`
  } catch {
    // fallthrough
  }
  return `Comment failed (${res.status})`
}

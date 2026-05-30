'use client'

import { useEffect, useRef, useState } from 'react'

const MAX_LEN = 5000
const HONEYPOT_FIELD = '_h'

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
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // Phase 14 honeypot — bots that auto-fill all visible-via-CSS fields
  // trip the check. Real users never see the input (off-screen + aria-hidden).
  const [honeyValue, setHoneyValue] = useState('')
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
    setErrorMsg(null)
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
            // Honeypot field — empty for real users, non-empty for naive bots.
            [HONEYPOT_FIELD]: honeyValue,
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
        // Phase 14 — surface 429 / spam / url-heavy with specific copy.
        const inline = await resolveInlineError(res)
        if (inline) {
          setErrorMsg(inline)
          return
        }
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
      {errorMsg && (
        <div className="comment-form__error" role="alert">
          {errorMsg}
        </div>
      )}
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
      {/* Honey-pot field — positioned off-screen, aria-hidden + tabIndex=-1
          so real users (sighted or AT) never reach it. Bots that auto-fill
          every input trip the server-side check. Only included on create. */}
      {mode === 'create' && (
        <input
          type="text"
          name={HONEYPOT_FIELD}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '-9999px',
            width: '1px',
            height: '1px',
            opacity: 0,
          }}
          value={honeyValue}
          onChange={(e) => setHoneyValue(e.target.value)}
        />
      )}
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

/**
 * Phase 14 — Map the rate-limit / abuse responses to inline copy. Returns
 * null when the response shouldn't be rendered inline (caller falls back
 * to the existing alert flow).
 */
async function resolveInlineError(res: Response): Promise<string | null> {
  if (res.status === 429) {
    const seconds = await readRetryAfter(res)
    return `Too many comments — try again in ${seconds}s.`
  }
  if (res.status === 400) {
    try {
      const j = (await res.clone().json()) as { error?: string }
      if (j.error === 'spam_detected') return 'Comment rejected.'
      if (j.error === 'too_many_urls') return 'Too many URLs in comment.'
    } catch {
      // fallthrough — non-JSON body or schema mismatch.
    }
  }
  return null
}

async function readRetryAfter(res: Response): Promise<number> {
  try {
    const j = (await res.clone().json()) as { retry_after?: number }
    if (typeof j.retry_after === 'number' && Number.isFinite(j.retry_after) && j.retry_after > 0) {
      return Math.ceil(j.retry_after)
    }
  } catch {
    // fallthrough
  }
  const header = res.headers.get('Retry-After')
  const parsed = header ? Number(header) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : 30
}

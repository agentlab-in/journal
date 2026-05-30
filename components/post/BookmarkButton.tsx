'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface BookmarkButtonProps {
  postId: string
  initialBookmarked: boolean
  isSignedIn: boolean
  /**
   * Path the viewer is currently on; used as the callbackUrl when an
   * anonymous viewer clicks the bookmark and is redirected to /auth/signin.
   */
  currentPath: string
}

export function BookmarkButton({
  postId,
  initialBookmarked,
  isSignedIn,
  currentPath,
}: BookmarkButtonProps) {
  const router = useRouter()
  const [bookmarked, setBookmarked] = useState(initialBookmarked)
  const [pending, setPending] = useState(false)
  // Phase 13 a11y: revert announcement (see LikeButton for context).
  const [revertMessage, setRevertMessage] = useState('')

  async function onClick() {
    if (!isSignedIn) {
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(currentPath)}`)
      return
    }
    if (pending) return

    const prev = bookmarked
    const next = !prev

    setBookmarked(next)
    setPending(true)
    setRevertMessage('')

    try {
      const res = await fetch(`/api/bookmarks/${postId}`, {
        method: next ? 'POST' : 'DELETE',
      })
      if (!res.ok) {
        setBookmarked(prev)
        setRevertMessage(
          next ? 'Bookmark failed, reverted.' : 'Bookmark removal failed, reverted.',
        )
        console.error('[BookmarkButton] toggle failed:', res.status)
        return
      }
      const data = (await res.json()) as { bookmarked: boolean }
      setBookmarked(data.bookmarked)
    } catch (err) {
      setBookmarked(prev)
      setRevertMessage(
        next ? 'Bookmark failed, reverted.' : 'Bookmark removal failed, reverted.',
      )
      console.error('[BookmarkButton] network error:', err)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark post'}
        aria-pressed={bookmarked}
        className={
          bookmarked ? 'bookmark-button bookmark-button--active' : 'bookmark-button'
        }
      >
        <svg
          aria-hidden="true"
          className="bookmark-button__icon"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill={bookmarked ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {revertMessage}
      </span>
    </>
  )
}

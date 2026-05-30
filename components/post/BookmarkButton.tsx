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

    try {
      const res = await fetch(`/api/bookmarks/${postId}`, {
        method: next ? 'POST' : 'DELETE',
      })
      if (!res.ok) {
        setBookmarked(prev)
        console.error('[BookmarkButton] toggle failed:', res.status)
        return
      }
      const data = (await res.json()) as { bookmarked: boolean }
      setBookmarked(data.bookmarked)
    } catch (err) {
      setBookmarked(prev)
      console.error('[BookmarkButton] network error:', err)
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark'}
      aria-pressed={bookmarked}
      className={
        bookmarked ? 'bookmark-button bookmark-button--active' : 'bookmark-button'
      }
    >
      <span aria-hidden="true" className="bookmark-button__glyph">
        {bookmarked ? '🔖' : '🏷'}
      </span>
    </button>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { readRetryAfter } from '@/lib/client/retry-after'

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
  // The counter `n` makes consecutive identical reverts unique so SRs
  // re-announce instead of de-duping.
  const [revert, setRevert] = useState<{ msg: string; n: number }>({ msg: '', n: 0 })

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
    setRevert((r) => ({ msg: '', n: r.n }))

    try {
      const res = await fetch(`/api/bookmarks/${postId}`, {
        method: next ? 'POST' : 'DELETE',
      })
      if (!res.ok) {
        setBookmarked(prev)
        let msg = next
          ? 'Bookmark failed, reverted.'
          : 'Bookmark removal failed, reverted.'
        if (res.status === 429) {
          const seconds = await readRetryAfter(res)
          msg = `Too many clicks — try again in ${seconds}s.`
        }
        setRevert((r) => ({ msg, n: r.n + 1 }))
        console.error('[BookmarkButton] toggle failed:', res.status)
        return
      }
      const data = (await res.json()) as { bookmarked: boolean }
      setBookmarked(data.bookmarked)
    } catch (err) {
      setBookmarked(prev)
      setRevert((r) => ({
        msg: next
          ? 'Bookmark failed, reverted.'
          : 'Bookmark removal failed, reverted.',
        n: r.n + 1,
      }))
      console.error('[BookmarkButton] network error:', err)
    } finally {
      setPending(false)
    }
  }

  // Phase 13 polish: shake-on-revert visual. See LikeButton for the
  // rationale on direct DOM toggling vs. re-key remounting.
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (revert.n === 0) return
    const node = buttonRef.current
    if (!node) return
    node.classList.add('shake-on-revert')
    const id = window.setTimeout(() => {
      node.classList.remove('shake-on-revert')
    }, 400)
    return () => {
      window.clearTimeout(id)
      node.classList.remove('shake-on-revert')
    }
  }, [revert.n])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-label="Bookmark post"
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
        {revert.msg ? `${revert.msg} (attempt ${revert.n})` : ''}
      </span>
    </>
  )
}

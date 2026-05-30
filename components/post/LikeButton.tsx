'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface LikeButtonProps {
  postId: string
  initialLiked: boolean
  initialCount: number
  isSignedIn: boolean
  /**
   * Path the viewer is currently on; used as the callbackUrl when an
   * anonymous viewer clicks the heart and is redirected to /auth/signin.
   */
  currentPath: string
}

export function LikeButton({
  postId,
  initialLiked,
  initialCount,
  isSignedIn,
  currentPath,
}: LikeButtonProps) {
  const router = useRouter()
  const [liked, setLiked] = useState(initialLiked)
  const [count, setCount] = useState(initialCount)
  const [pending, setPending] = useState(false)
  // Phase 13 a11y: assistive-tech announcement when an optimistic update
  // gets reverted (network or 5xx). We pair the message with a monotonic
  // counter `n` so consecutive identical reverts still produce unique DOM
  // text — screen readers de-dupe identical sibling text changes, so two
  // back-to-back "Like failed" messages would be announced only once
  // without the suffix. Kept in sr-only span below.
  const [revert, setRevert] = useState<{ msg: string; n: number }>({ msg: '', n: 0 })

  async function onClick() {
    if (!isSignedIn) {
      // Anon: bounce through sign-in. Never call the API for anon clicks.
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(currentPath)}`)
      return
    }
    if (pending) return

    const prevLiked = liked
    const prevCount = count
    const nextLiked = !prevLiked
    const nextCount = prevCount + (nextLiked ? 1 : -1)

    // Optimistic flip — render the new state immediately, reconcile on response.
    setLiked(nextLiked)
    setCount(nextCount)
    setPending(true)
    // Clear any prior revert message at the start of a new attempt; keep the
    // counter so the next failure bumps to a unique value.
    setRevert((r) => ({ msg: '', n: r.n }))

    try {
      const res = await fetch(`/api/likes/${postId}`, {
        method: nextLiked ? 'POST' : 'DELETE',
      })
      if (!res.ok) {
        setLiked(prevLiked)
        setCount(prevCount)
        setRevert((r) => ({
          msg: nextLiked ? 'Like failed, reverted.' : 'Unlike failed, reverted.',
          n: r.n + 1,
        }))
        console.error('[LikeButton] toggle failed:', res.status)
        return
      }
      const data = (await res.json()) as { liked: boolean; like_count: number }
      // Reconcile from server truth (handles races / idempotent retries).
      setLiked(data.liked)
      setCount(data.like_count)
    } catch (err) {
      setLiked(prevLiked)
      setCount(prevCount)
      setRevert((r) => ({
        msg: nextLiked ? 'Like failed, reverted.' : 'Unlike failed, reverted.',
        n: r.n + 1,
      }))
      console.error('[LikeButton] network error:', err)
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
        aria-label="Like post"
        aria-pressed={liked}
        className={liked ? 'like-button like-button--active' : 'like-button'}
      >
        <svg
          aria-hidden="true"
          className="like-button__icon"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill={liked ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        <span className="like-button__count">{count}</span>
      </button>
      {/* aria-live region for optimistic-revert announcements. Empty on
          initial render so screen-readers stay silent until a revert
          actually happens. The `(attempt N)` suffix keeps each DOM text
          change unique so consecutive identical reverts re-announce.
          sr-only keeps it visually hidden. */}
      <span role="status" aria-live="polite" className="sr-only">
        {revert.msg ? `${revert.msg} (attempt ${revert.n})` : ''}
      </span>
    </>
  )
}

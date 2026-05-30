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

    try {
      const res = await fetch(`/api/likes/${postId}`, {
        method: nextLiked ? 'POST' : 'DELETE',
      })
      if (!res.ok) {
        setLiked(prevLiked)
        setCount(prevCount)
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
      console.error('[LikeButton] network error:', err)
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={liked ? 'Unlike' : 'Like'}
      aria-pressed={liked}
      className={liked ? 'like-button like-button--active' : 'like-button'}
    >
      <span aria-hidden="true" className="like-button__glyph">
        {liked ? '♥' : '♡'}
      </span>
      <span className="like-button__count">{count}</span>
    </button>
  )
}

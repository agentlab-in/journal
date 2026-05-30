'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface FollowButtonProps {
  targetUserId: string
  initialFollowing: boolean
  /**
   * Snapshot of the followed user's `follower_count` at render time. Held
   * locally so the button can keep its own optimistic state in sync with
   * the server's reconciled count even though the visible counter lives
   * up in <ProfileHeader>. Not rendered in this component.
   */
  initialFollowerCount: number
  isSignedIn: boolean
  /**
   * Path the viewer is currently on; used as the callbackUrl when an
   * anonymous viewer clicks Follow and is redirected to /auth/signin.
   */
  currentPath: string
}

export function FollowButton({
  targetUserId,
  initialFollowing,
  initialFollowerCount,
  isSignedIn,
  currentPath,
}: FollowButtonProps) {
  const router = useRouter()
  const [following, setFollowing] = useState(initialFollowing)
  const [, setFollowerCount] = useState(initialFollowerCount)
  const [pending, setPending] = useState(false)

  async function onClick() {
    if (!isSignedIn) {
      // Anon: bounce through sign-in. Never call the API for anon clicks.
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(currentPath)}`)
      return
    }
    if (pending) return

    const prevFollowing = following
    const nextFollowing = !prevFollowing

    // Optimistic flip — render the new state immediately, reconcile on response.
    setFollowing(nextFollowing)
    setFollowerCount((c) => c + (nextFollowing ? 1 : -1))
    setPending(true)

    try {
      const res = await fetch(`/api/follows/${targetUserId}`, {
        method: nextFollowing ? 'POST' : 'DELETE',
      })
      if (!res.ok) {
        setFollowing(prevFollowing)
        setFollowerCount((c) => c + (nextFollowing ? -1 : 1))
        console.error('[FollowButton] toggle failed:', res.status)
        return
      }
      const data = (await res.json()) as {
        following: boolean
        follower_count: number
      }
      // Reconcile from server truth (handles races / idempotent retries).
      setFollowing(data.following)
      setFollowerCount(data.follower_count)
    } catch (err) {
      setFollowing(prevFollowing)
      setFollowerCount((c) => c + (nextFollowing ? -1 : 1))
      console.error('[FollowButton] network error:', err)
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={following ? 'Unfollow' : 'Follow'}
      aria-pressed={following}
      className={
        following ? 'follow-button follow-button--active' : 'follow-button'
      }
    >
      {following ? 'Following' : 'Follow'}
    </button>
  )
}

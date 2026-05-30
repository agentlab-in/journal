'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface FollowButtonProps {
  targetUserId: string
  initialFollowing: boolean
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
  isSignedIn,
  currentPath,
}: FollowButtonProps) {
  const router = useRouter()
  const [following, setFollowing] = useState(initialFollowing)
  const [pending, setPending] = useState(false)

  async function onClick() {
    if (!isSignedIn) {
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(currentPath)}`)
      return
    }
    if (pending) return

    const prevFollowing = following
    const nextFollowing = !prevFollowing

    setFollowing(nextFollowing)
    setPending(true)

    try {
      const res = await fetch(`/api/follows/${targetUserId}`, {
        method: nextFollowing ? 'POST' : 'DELETE',
      })
      if (!res.ok) {
        setFollowing(prevFollowing)
        console.error('[FollowButton] toggle failed:', res.status)
        return
      }
      const data = (await res.json()) as { following: boolean }
      setFollowing(data.following)
    } catch (err) {
      setFollowing(prevFollowing)
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

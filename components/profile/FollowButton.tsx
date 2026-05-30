'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface FollowButtonProps {
  targetUserId: string
  /**
   * Handle (without leading @) of the profile being followed. Used to build
   * a stable aria-label like "Follow @alice" so screen readers always
   * announce the action verb plus the target, while aria-pressed conveys
   * the toggle state. See ARIA Authoring Practices toggle pattern.
   */
  username: string
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
  username,
  initialFollowing,
  isSignedIn,
  currentPath,
}: FollowButtonProps) {
  const router = useRouter()
  const [following, setFollowing] = useState(initialFollowing)
  const [pending, setPending] = useState(false)
  // Phase 13 a11y: revert announcement (see LikeButton for context).
  const [revertMessage, setRevertMessage] = useState('')

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
    setRevertMessage('')

    try {
      const res = await fetch(`/api/follows/${targetUserId}`, {
        method: nextFollowing ? 'POST' : 'DELETE',
      })
      if (!res.ok) {
        setFollowing(prevFollowing)
        setRevertMessage(
          nextFollowing ? 'Follow failed, reverted.' : 'Unfollow failed, reverted.',
        )
        console.error('[FollowButton] toggle failed:', res.status)
        return
      }
      const data = (await res.json()) as { following: boolean }
      setFollowing(data.following)
    } catch (err) {
      setFollowing(prevFollowing)
      setRevertMessage(
        nextFollowing ? 'Follow failed, reverted.' : 'Unfollow failed, reverted.',
      )
      console.error('[FollowButton] network error:', err)
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
        aria-label={`Follow @${username}`}
        aria-pressed={following}
        className={
          following ? 'follow-button follow-button--active' : 'follow-button'
        }
      >
        {following ? 'Following' : 'Follow'}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {revertMessage}
      </span>
    </>
  )
}

'use client'

import { useState } from 'react'
import { ProfilePostCard } from './ProfilePostCard'
import type { ProfilePostCardData } from './ProfilePostCard'

export interface PinnedPostsProps {
  username: string
  pins: Array<ProfilePostCardData & { position: number }>
  isOwner: boolean
}

export function PinnedPosts({ username, pins, isOwner }: PinnedPostsProps) {
  const [items, setItems] = useState(pins)
  const [pendingId, setPendingId] = useState<string | null>(null)

  if (items.length === 0) return null

  async function unpin(postId: string) {
    if (pendingId) return
    setPendingId(postId)
    // Optimistic remove
    const previous = items
    setItems((curr) => curr.filter((p) => p.id !== postId))
    try {
      const res = await fetch(`/api/pinned-posts/${postId}`, { method: 'DELETE' })
      if (!res.ok) {
        setItems(previous)
        window.alert('Unpin failed.')
      }
    } catch {
      setItems(previous)
      window.alert('Unpin failed.')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <section className="profile-pinned" aria-labelledby="profile-pinned-heading">
      <h2 id="profile-pinned-heading" className="profile-section-heading">
        Pinned
      </h2>
      <div className="profile-pinned__grid">
        {items.map((p) => (
          <ProfilePostCard
            key={p.id}
            username={username}
            post={p}
            action={
              isOwner ? (
                <button
                  type="button"
                  className="pin-action pin-action--unpin"
                  disabled={pendingId === p.id}
                  onClick={() => unpin(p.id)}
                  aria-label={`Unpin ${p.title}`}
                >
                  {pendingId === p.id ? 'Unpinning…' : 'Unpin'}
                </button>
              ) : undefined
            }
          />
        ))}
      </div>
    </section>
  )
}

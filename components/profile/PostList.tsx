'use client'

import { useMemo, useState } from 'react'
import { ProfilePostCard } from './ProfilePostCard'
import type { ProfilePostCardData } from './ProfilePostCard'
import type { PostType } from '@/lib/posts/url'
import { KeyboardFeedNav } from '@/components/keyboard/KeyboardFeedNav'

type FilterValue = 'all' | PostType

const FILTERS: ReadonlyArray<{ value: FilterValue; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'post', label: 'Posts' },
  { value: 'playbook', label: 'Playbooks' },
  { value: 'dive', label: 'Dives' },
]

const MAX_PINS = 6

export interface PostListProps {
  username: string
  posts: ProfilePostCardData[]
  isOwner: boolean
  /** Post ids already pinned (used to hide the Pin button on pinned cards). */
  initialPinnedIds: string[]
}

export function PostList({
  username,
  posts,
  isOwner,
  initialPinnedIds,
}: PostListProps) {
  const [filter, setFilter] = useState<FilterValue>('all')
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(
    () => new Set(initialPinnedIds),
  )
  const [pendingId, setPendingId] = useState<string | null>(null)

  const visible = useMemo(() => {
    if (filter === 'all') return posts
    return posts.filter((p) => p.type === filter)
  }, [filter, posts])

  async function pin(postId: string) {
    if (pendingId) return
    if (pinnedIds.size >= MAX_PINS) {
      window.alert(`You can pin at most ${MAX_PINS} posts.`)
      return
    }
    setPendingId(postId)
    const previous = new Set(pinnedIds)
    setPinnedIds((curr) => new Set(curr).add(postId))
    try {
      const res = await fetch('/api/pinned-posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ post_id: postId }),
      })
      if (!res.ok) {
        setPinnedIds(previous)
        window.alert('Pin failed.')
      }
    } catch {
      setPinnedIds(previous)
      window.alert('Pin failed.')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <section className="profile-posts" aria-labelledby="profile-posts-heading">
      <div className="profile-posts__header">
        <h2 id="profile-posts-heading" className="profile-section-heading">
          Posts
        </h2>
        <div
          className="profile-posts__filters"
          role="tablist"
          aria-label="Filter by post type"
        >
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              className={
                filter === f.value
                  ? 'filter-chip filter-chip--active'
                  : 'filter-chip'
              }
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="profile-posts__empty">No posts yet.</p>
      ) : (
        <KeyboardFeedNav>
          <ul className="profile-posts__list">
            {visible.map((p) => {
              const isPinned = pinnedIds.has(p.id)
              const canPin =
                isOwner && !isPinned && pinnedIds.size < MAX_PINS
              return (
                <li key={p.id}>
                  <ProfilePostCard
                    username={username}
                    post={p}
                    action={
                      canPin ? (
                        <button
                          type="button"
                          className="pin-action pin-action--pin"
                          disabled={pendingId === p.id}
                          onClick={() => pin(p.id)}
                          aria-label={`Pin ${p.title}`}
                        >
                          {pendingId === p.id ? 'Pinning…' : 'Pin'}
                        </button>
                      ) : undefined
                    }
                  />
                </li>
              )
            })}
          </ul>
        </KeyboardFeedNav>
      )}
    </section>
  )
}

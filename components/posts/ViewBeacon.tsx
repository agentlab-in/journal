'use client'

import { useEffect } from 'react'

export interface ViewBeaconProps {
  postId: string
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export function ViewBeacon({ postId }: ViewBeaconProps) {
  useEffect(() => {
    const key = `agentlab.viewed.${postId}`

    // localStorage throws in private-browsing (older Safari) and when the
    // quota is full. The beacon is best-effort; on any failure we just
    // fire and move on so the page never crashes.
    try {
      const stored = localStorage.getItem(key)
      if (stored) {
        const storedTime = new Date(stored).getTime()
        if (!isNaN(storedTime) && Date.now() - storedTime < TWENTY_FOUR_HOURS_MS) {
          return
        }
      }
      localStorage.setItem(key, new Date().toISOString())
    } catch {
      // ignore — fire the beacon anyway
    }

    fetch(`/api/posts/${postId}/view`, { method: 'POST', keepalive: true }).catch(
      () => {
        // fire-and-forget
      },
    )
  }, [postId])

  return null
}

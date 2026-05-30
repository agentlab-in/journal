'use client'

/**
 * <KeyboardFeedNav /> — j / k / Enter traversal for feed surfaces.
 *
 * Wraps the existing post-card list (the children are an <ul> / grid).
 * Walks the DOM for `[data-feed-card]` elements at runtime so it stays
 * decoupled from PostCard / ProfilePostCard markup — those components
 * just need to expose `data-feed-card` + `data-href={postUrl}` on their
 * root element. The wrapper does not own focusable cards (each card is
 * `tabIndex={-1}` so the browser's Tab order isn't polluted with N+ stops
 * per feed).
 *
 * Shortcuts:
 *   j        → focus + scrollIntoView next card
 *   k        → focus + scrollIntoView previous card
 *   Enter    → navigate to the focused card's `data-href`
 *
 * Same guard as NavSearch: if the user is typing in an input / textarea /
 * contenteditable, or holding a modifier, the shortcut is ignored.
 */

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isTypingTarget(): boolean {
  const active = document.activeElement as HTMLElement | null
  if (!active) return false
  if (TEXT_INPUT_TAGS.has(active.tagName)) return true
  if (active.isContentEditable) return true
  return false
}

export interface KeyboardFeedNavProps {
  children: React.ReactNode
  /**
   * Optional className passed through to the wrapper element. Default is
   * `contents` so the wrapper is layout-transparent (Grid/Flex children
   * still resolve against the original parent). Callers can override when
   * the list itself needs a wrapping container.
   */
  className?: string
}

export function KeyboardFeedNav({ children, className }: KeyboardFeedNavProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const focusedIndexRef = useRef<number>(-1)
  const router = useRouter()

  useEffect(() => {
    function getCards(): HTMLElement[] {
      const root = containerRef.current
      if (!root) return []
      return Array.from(
        root.querySelectorAll<HTMLElement>('[data-feed-card]'),
      )
    }

    function focusCard(cards: HTMLElement[], index: number) {
      if (cards.length === 0) return
      const clamped = Math.max(0, Math.min(index, cards.length - 1))
      const card = cards[clamped]
      focusedIndexRef.current = clamped
      card.focus({ preventScroll: true })
      card.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'j' && e.key !== 'k' && e.key !== 'Enter') return
      if (isTypingTarget()) return

      const cards = getCards()
      if (cards.length === 0) return

      // If the user's focus has moved off-cards (e.g. tabbed to a link),
      // sync our pointer to whatever card currently has focus, or back to
      // the last one we tracked.
      const active = document.activeElement as HTMLElement | null
      const activeIdx = active ? cards.indexOf(active) : -1
      const current =
        activeIdx >= 0 ? activeIdx : focusedIndexRef.current

      if (e.key === 'j') {
        e.preventDefault()
        focusCard(cards, current < 0 ? 0 : current + 1)
        return
      }
      if (e.key === 'k') {
        e.preventDefault()
        focusCard(cards, current < 0 ? 0 : current - 1)
        return
      }
      // Enter: only intercept when a feed card is currently focused —
      // otherwise the browser's default behaviour (submit form, follow
      // link) must win.
      if (e.key === 'Enter') {
        if (activeIdx < 0) return
        const href = cards[activeIdx].getAttribute('data-href')
        if (!href) return
        e.preventDefault()
        router.push(href)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [router])

  return (
    <div ref={containerRef} className={className ?? 'contents'}>
      {children}
    </div>
  )
}

export default KeyboardFeedNav

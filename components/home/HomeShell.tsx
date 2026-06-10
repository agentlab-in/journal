/**
 * HomeShell — three-column named-slot grid wrapper.
 *
 * CRITICAL: This component MUST remain synchronous (no `async`, no `await`,
 * no `'use client'`). The streaming benefit of this layout depends on the
 * shell painting immediately to the browser so content can stream into each
 * slot independently. Making it async would block the shell and defeat the
 * whole point. Do not add `async` to this component under any circumstances.
 *
 * Responsive columns (locked — see issue #54 Phase A spec):
 *   xl (>=1280px): 3-col  200px · minmax(0,1fr) · 280px
 *   lg (1024-1279): 2-col minmax(0,1fr) · 260px  (left hidden)
 *   <lg (<=1023px): single col (both asides hidden, LeftNav in top nav)
 */

import type { ReactNode } from 'react'

export interface HomeShellProps {
  left: ReactNode
  center: ReactNode
  right: ReactNode
}

export function HomeShell({ left, center, right }: HomeShellProps) {
  return (
    <div className="home-shell grid gap-8 xl:grid-cols-[200px_minmax(0,1fr)_280px] lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-6">
      <aside className="home-shell__left hidden xl:block" aria-label="Primary navigation">{left}</aside>
      <div className="home-shell__center min-w-0">{center}</div>
      <aside className="home-shell__right hidden lg:block" aria-label="Showcase">{right}</aside>
    </div>
  )
}

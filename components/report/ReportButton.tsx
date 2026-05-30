'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ReportModal } from './ReportModal'

export interface ReportButtonProps {
  targetType: 'post' | 'comment' | 'user'
  targetId: string
  isSignedIn: boolean
  currentPath: string
  /**
   * Optional: hide on author's own content. Set by the surface to true
   * if `viewerId === target.authorId`. Server-side check is still the
   * authoritative gate; this is just to not show a doomed button.
   */
  isSelf?: boolean
}

export function ReportButton({
  targetType,
  targetId,
  isSignedIn,
  currentPath,
  isSelf = false,
}: ReportButtonProps) {
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)

  // Don't render if viewing own content
  if (isSelf) return null

  function handleClick() {
    if (!isSignedIn) {
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(currentPath)}`)
      return
    }
    setModalOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="report-button"
        aria-label={`Report this ${targetType}`}
        title={`Report this ${targetType}`}
      >
        <svg
          aria-hidden="true"
          className="report-button__icon"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Flag icon */}
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
      </button>

      {modalOpen && (
        <ReportModal
          targetType={targetType}
          targetId={targetId}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  )
}

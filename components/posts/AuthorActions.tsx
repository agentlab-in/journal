'use client'

import Link from 'next/link'
import { useState } from 'react'

export interface AuthorActionsProps {
  postId: string
}

export function AuthorActions({ postId }: AuthorActionsProps) {
  const [isDeleting, setIsDeleting] = useState(false)

  async function onDelete() {
    if (isDeleting) return
    if (!window.confirm('Delete this post? This cannot be undone.')) return
    setIsDeleting(true)
    const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' })
    if (res.ok) {
      window.location.assign('/')
    } else {
      window.alert('Delete failed.')
      setIsDeleting(false)
    }
  }

  return (
    <div className="author-actions">
      <Link href={`/write/${postId}`} className="author-actions__edit">
        Edit
      </Link>
      <button
        onClick={onDelete}
        className="author-actions__delete"
        disabled={isDeleting}
      >
        {isDeleting ? 'Deleting…' : 'Delete'}
      </button>
    </div>
  )
}

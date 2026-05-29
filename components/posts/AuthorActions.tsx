'use client'

import Link from 'next/link'

export interface AuthorActionsProps {
  postId: string
}

export function AuthorActions({ postId }: AuthorActionsProps) {
  async function onDelete() {
    if (!window.confirm('Delete this post? This cannot be undone.')) return
    const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' })
    if (res.ok) {
      window.location.assign('/')
    } else {
      window.alert('Delete failed.')
    }
  }

  return (
    <div className="author-actions">
      <Link href={`/write?edit=${postId}`} className="author-actions__edit">
        Edit
      </Link>
      <button onClick={onDelete} className="author-actions__delete">
        Delete
      </button>
    </div>
  )
}

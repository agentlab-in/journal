'use client'

/**
 * Org members panel — list, add (by username), change role, remove, leave.
 *
 * State is kept locally and mutated after each successful API call so the
 * caller doesn't have to round-trip the server component to see updates.
 * The "last admin" guard at the DB level surfaces as a 409 here — we render
 * an inline message so the admin knows why their action was rejected.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface OrgMember {
  user_id: string
  username: string
  display_name: string
  avatar_url: string | null
  role: 'admin' | 'member'
}

export interface OrgMembersPanelProps {
  slug: string
  callerUserId: string
  initialMembers: OrgMember[]
}

interface ApiError {
  error?: string
  issues?: Array<{ message?: string }>
}

export function OrgMembersPanel({
  slug,
  callerUserId,
  initialMembers,
}: OrgMembersPanelProps) {
  const router = useRouter()
  const [members, setMembers] = useState<OrgMember[]>(initialMembers)
  const [addUsername, setAddUsername] = useState('')
  const [addRole, setAddRole] = useState<'admin' | 'member'>('member')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  // Per-row error keyed by user_id for last-admin / network failures.
  const [rowError, setRowError] = useState<Record<string, string>>({})

  function setRowErr(uid: string, msg: string | null) {
    setRowError((prev) => {
      const next = { ...prev }
      if (msg === null) delete next[uid]
      else next[uid] = msg
      return next
    })
  }

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (adding) return
    setAddError(null)
    setAdding(true)
    try {
      const res = await fetch(`/api/orgs/${slug}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: addUsername.trim(), role: addRole }),
      })
      const body = (await res.json().catch(() => ({}))) as ApiError
      if (!res.ok) {
        if (body.error === 'user_not_found') {
          setAddError(`No user @${addUsername}.`)
        } else if (body.error === 'already_member') {
          setAddError(`@${addUsername} is already a member.`)
        } else if (body.error === 'invalid_body' && body.issues?.[0]) {
          setAddError(body.issues[0].message ?? 'Invalid input.')
        } else {
          setAddError(body.error ?? `Add failed (${res.status}).`)
        }
        return
      }
      // Refresh server data so the new row's display_name/avatar populate
      // without a manual fetch here.
      setAddUsername('')
      setAddRole('member')
      router.refresh()
    } catch {
      setAddError('Network error.')
    } finally {
      setAdding(false)
    }
  }

  async function handleRoleChange(
    member: OrgMember,
    nextRole: 'admin' | 'member',
  ) {
    if (member.role === nextRole) return
    setRowErr(member.user_id, null)
    try {
      const res = await fetch(
        `/api/orgs/${slug}/members/${member.user_id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: nextRole }),
        },
      )
      const body = (await res.json().catch(() => ({}))) as ApiError
      if (!res.ok) {
        if (body.error === 'last_admin') {
          setRowErr(member.user_id, 'Can’t demote the last admin.')
        } else {
          setRowErr(
            member.user_id,
            body.error ?? `Update failed (${res.status}).`,
          )
        }
        return
      }
      setMembers((prev) =>
        prev.map((m) =>
          m.user_id === member.user_id ? { ...m, role: nextRole } : m,
        ),
      )
    } catch {
      setRowErr(member.user_id, 'Network error.')
    }
  }

  async function handleRemove(member: OrgMember) {
    setRowErr(member.user_id, null)
    const isSelf = member.user_id === callerUserId
    const confirmMsg = isSelf
      ? `Leave ${slug}?`
      : `Remove @${member.username} from ${slug}?`
    if (!window.confirm(confirmMsg)) return
    try {
      const res = await fetch(
        `/api/orgs/${slug}/members/${member.user_id}`,
        { method: 'DELETE' },
      )
      const body = (await res.json().catch(() => ({}))) as ApiError
      if (!res.ok) {
        if (body.error === 'last_admin') {
          setRowErr(
            member.user_id,
            'Can’t remove the last admin. Promote someone else first.',
          )
        } else {
          setRowErr(
            member.user_id,
            body.error ?? `Remove failed (${res.status}).`,
          )
        }
        return
      }
      if (isSelf) {
        // Caller left — they no longer have admin access here.
        router.push('/settings/profile')
        return
      }
      setMembers((prev) => prev.filter((m) => m.user_id !== member.user_id))
    } catch {
      setRowErr(member.user_id, 'Network error.')
    }
  }

  return (
    <section className="settings-section" data-testid="org-members-panel">
      <h2 className="settings-section-heading">Members</h2>

      <ul className="settings-members-list">
        {members.map((m) => {
          const isSelf = m.user_id === callerUserId
          const err = rowError[m.user_id]
          return (
            <li
              key={m.user_id}
              className="settings-members-row"
              data-testid={`org-member-${m.username}`}
            >
              <span className="settings-members-name">
                {m.display_name}{' '}
                <span className="settings-members-handle">@{m.username}</span>
                {isSelf ? ' (you)' : null}
              </span>
              <select
                aria-label={`Role for @${m.username}`}
                value={m.role}
                onChange={(e) =>
                  void handleRoleChange(
                    m,
                    e.target.value as 'admin' | 'member',
                  )
                }
                className="settings-members-role"
              >
                <option value="admin">admin</option>
                <option value="member">member</option>
              </select>
              <button
                type="button"
                onClick={() => void handleRemove(m)}
                className="settings-members-remove"
              >
                {isSelf ? 'Leave' : 'Remove'}
              </button>
              {err ? (
                <span className="settings-error" role="alert">
                  {err}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>

      <form
        onSubmit={handleAdd}
        className="settings-members-add"
        data-testid="org-members-add"
      >
        <label className="settings-field">
          <span className="settings-label">Add member by username</span>
          <input
            type="text"
            className="settings-input"
            value={addUsername}
            onChange={(e) => setAddUsername(e.target.value.toLowerCase())}
            placeholder="username"
          />
        </label>
        <label className="settings-field">
          <span className="settings-label">Role</span>
          <select
            value={addRole}
            onChange={(e) => setAddRole(e.target.value as 'admin' | 'member')}
            className="settings-input"
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button
          type="submit"
          className="settings-submit"
          disabled={adding || addUsername.trim().length === 0}
        >
          {adding ? 'Adding…' : 'Add'}
        </button>
        {addError ? (
          <span className="settings-error" role="alert">
            {addError}
          </span>
        ) : null}
      </form>
    </section>
  )
}

export default OrgMembersPanel

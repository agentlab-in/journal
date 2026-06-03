'use client'

/**
 * "Your orgs" section on /settings/profile. Lists the caller's orgs with
 * role + a Manage link (admins only) + a Leave button. Self-leave goes
 * through the same DELETE /api/orgs/[slug]/members/[user_id] endpoint as
 * admin-remove and surfaces the last-admin 409 inline.
 *
 * Empty state nudges to /settings/orgs/new.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export interface OrgListEntry {
  id: string
  slug: string
  display_name: string
  role: 'admin' | 'member'
}

export interface OrgsListSectionProps {
  callerUserId: string
  orgs: OrgListEntry[]
}

export function OrgsListSection({ callerUserId, orgs }: OrgsListSectionProps) {
  const router = useRouter()
  const [items, setItems] = useState<OrgListEntry[]>(orgs)
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  function setRowErr(id: string, msg: string | null) {
    setRowError((prev) => {
      const next = { ...prev }
      if (msg === null) delete next[id]
      else next[id] = msg
      return next
    })
  }

  async function handleLeave(org: OrgListEntry) {
    if (busy) return
    if (!window.confirm(`Leave ${org.display_name}?`)) return
    setRowErr(org.id, null)
    setBusy(org.id)
    try {
      const res = await fetch(
        `/api/orgs/${org.slug}/members/${callerUserId}`,
        { method: 'DELETE' },
      )
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        if (body.error === 'last_admin') {
          setRowErr(
            org.id,
            'You’re the last admin. Promote someone else first.',
          )
        } else {
          setRowErr(org.id, body.error ?? `Leave failed (${res.status}).`)
        }
        return
      }
      setItems((prev) => prev.filter((o) => o.id !== org.id))
      router.refresh()
    } catch {
      setRowErr(org.id, 'Network error.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="settings-section" id="orgs" data-testid="orgs-list-section">
      <h2 className="settings-section-heading">Your orgs</h2>

      {items.length === 0 ? (
        <p className="settings-help">
          You’re not in any orgs yet.{' '}
          <Link href="/settings/orgs/new" className="settings-link">
            Create your first org →
          </Link>
        </p>
      ) : (
        <>
          <ul className="settings-orgs-list">
            {items.map((o) => (
              <li
                key={o.id}
                className="settings-orgs-row"
                data-testid={`orgs-row-${o.slug}`}
              >
                <span className="settings-orgs-name">
                  {o.display_name}{' '}
                  <span className="settings-orgs-handle">@{o.slug}</span>
                </span>
                <span className="settings-orgs-role">{o.role}</span>
                {o.role === 'admin' ? (
                  <Link
                    href={`/settings/orgs/${o.slug}`}
                    className="settings-orgs-manage"
                  >
                    Manage
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleLeave(o)}
                  disabled={busy === o.id}
                  className="settings-orgs-leave"
                >
                  {busy === o.id ? 'Leaving…' : 'Leave'}
                </button>
                {rowError[o.id] ? (
                  <span className="settings-error" role="alert">
                    {rowError[o.id]}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="settings-help">
            <Link href="/settings/orgs/new" className="settings-link">
              Create another org →
            </Link>
          </p>
        </>
      )}
    </section>
  )
}

export default OrgsListSection

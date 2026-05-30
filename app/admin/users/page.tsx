import Link from 'next/link'
import type { Metadata } from 'next'
import { searchUsers } from '@/lib/admin/search-users'
import type { AdminUserRow, AdminModActionRow } from '@/lib/admin/search-users'
import UserActions from '@/components/admin/UserActions'

export const metadata: Metadata = {
  title: 'Users — Admin',
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function formatDate(iso: string) {
  return DATE_FMT.format(new Date(iso))
}

interface PageSearchParams {
  q?: string
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>
}) {
  const sp = await searchParams
  const q = (sp?.q ?? '').trim()

  const users: AdminUserRow[] = q ? await searchUsers({ q, limit: 20 }) : []

  return (
    <section>
      <h2 className="font-mono text-lg font-semibold mb-4">Users</h2>

      <form action="/admin/users" method="get" className="mb-6 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by username..."
          aria-label="User search"
          className="border border-border rounded px-3 py-1.5 text-sm flex-1 max-w-xs"
          autoComplete="off"
        />
        <button
          type="submit"
          className="px-3 py-1.5 text-sm border border-border rounded hover:bg-surface-raised"
        >
          Search
        </button>
      </form>

      {!q && (
        <p className="text-fg-subtle text-sm">Enter a username to search.</p>
      )}

      {q && users.length === 0 && (
        <p className="text-fg-subtle text-sm">No users found for &ldquo;{q}&rdquo;.</p>
      )}

      {users.length > 0 && (
        <div className="flex flex-col gap-6">
          {users.map((user: AdminUserRow) => (
            <div key={user.id} className="border border-border rounded p-4 flex flex-col gap-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 items-baseline">
                <Link href={`/${user.username}`} className="font-mono font-semibold underline" target="_blank">
                  @{user.username}
                </Link>
                {user.display_name && (
                  <span className="text-fg-subtle text-sm">{user.display_name}</span>
                )}
                <span className="text-fg-subtle text-xs">
                  Joined {formatDate(user.created_at)}
                </span>
                {user.banned_at && (
                  <span className="text-red-600 text-xs font-medium">
                    Banned {formatDate(user.banned_at)}
                    {user.banned_reason && `: ${user.banned_reason}`}
                  </span>
                )}
              </div>

              <UserActions user={user} />

              {user.recent_mod_actions.length > 0 && (
                <div>
                  <p className="text-xs text-fg-subtle mb-1 font-medium">Recent mod actions:</p>
                  <ul className="flex flex-col gap-1">
                    {user.recent_mod_actions.map((a: AdminModActionRow) => (
                      <li key={a.id} className="text-xs text-fg-subtle">
                        <time dateTime={a.created_at}>{formatDate(a.created_at)}</time>
                        {' — '}
                        <span className="font-mono">{a.action}</span>
                        {a.mod_username && ` by @${a.mod_username}`}
                        {a.reason && ` (${a.reason})`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

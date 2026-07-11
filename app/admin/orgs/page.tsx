import Link from 'next/link'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin'
import { searchOrgs } from '@/lib/admin/search-orgs'
import type { AdminOrgRow, AdminOrgStatus } from '@/lib/admin/search-orgs'
import OrgActions from '@/components/admin/OrgActions'

export const metadata: Metadata = {
  // Resolves to `Orgs · Admin — agentlab.in` via the admin layout's template.
  title: 'Orgs',
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

const STATUS_OPTIONS: AdminOrgStatus[] = ['all', 'active', 'banned', 'deleted']

function isValidStatus(value: string | undefined): value is AdminOrgStatus {
  return value !== undefined && (STATUS_OPTIONS as string[]).includes(value)
}

interface PageSearchParams {
  q?: string
  status?: string
}

export default async function AdminOrgsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>
}) {
  const session = await getSession()
  await requireAdmin(session) // throws notFound() for non-admin; per-request defense-in-depth (layout is not an auth boundary)

  const sp = await searchParams
  const q = (sp?.q ?? '').trim()
  const status: AdminOrgStatus = isValidStatus(sp?.status) ? sp.status : 'all'

  const orgs: AdminOrgRow[] = await searchOrgs({ q, status, limit: 25 })

  return (
    <section>
      <h2 className="font-mono text-lg font-semibold mb-4">Orgs</h2>

      <form
        action="/admin/orgs"
        method="get"
        className="mb-6 flex flex-wrap gap-2 items-end"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-xs text-fg-subtle">
            Search
          </label>
          <input
            id="q"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="slug or display name..."
            aria-label="Org search"
            className="border border-border rounded px-3 py-1.5 text-sm w-64"
            autoComplete="off"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="text-xs text-fg-subtle">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="border border-border rounded px-2 py-1.5 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="px-3 py-1.5 text-sm border border-border rounded hover:bg-bg-hover"
        >
          Filter
        </button>

        {(q || status !== 'all') && (
          <Link
            href="/admin/orgs"
            className="text-xs text-fg-subtle underline self-end pb-2"
          >
            Clear filters
          </Link>
        )}
      </form>

      {orgs.length === 0 ? (
        <p className="text-fg-subtle text-sm">No orgs found.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {orgs.map((org: AdminOrgRow) => (
            <div
              key={org.id}
              className="border border-border rounded p-4 flex flex-col gap-3"
            >
              <div className="flex flex-wrap gap-x-4 gap-y-1 items-baseline">
                <Link
                  href={`/${org.slug}`}
                  className="font-mono font-semibold underline"
                  target="_blank"
                >
                  {org.slug}
                </Link>
                <span className="text-fg-subtle text-sm">
                  {org.display_name}
                </span>
                <span className="text-fg-subtle text-xs">
                  Created {formatDate(org.created_at)}
                </span>
                {org.created_by_username && (
                  <span className="text-fg-subtle text-xs">
                    by{' '}
                    <Link
                      href={`/${org.created_by_username}`}
                      target="_blank"
                      className="underline"
                    >
                      @{org.created_by_username}
                    </Link>
                  </span>
                )}
                {org.banned_at && (
                  <span className="text-red-600 text-xs font-medium">
                    Banned {formatDate(org.banned_at)}
                    {org.banned_reason && `: ${org.banned_reason}`}
                  </span>
                )}
                {org.deleted_at && (
                  <span className="text-fg-subtle text-xs font-medium">
                    Deleted {formatDate(org.deleted_at)}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-subtle">
                <span>{org.member_count} members</span>
                <span>{org.post_count} posts</span>
              </div>

              <OrgActions org={org} />

              <div>
                <Link
                  href={`/admin/audit?target_type=org&target_id=${encodeURIComponent(org.id)}`}
                  className="text-xs underline text-fg-subtle hover:text-fg"
                >
                  Recent mod actions
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

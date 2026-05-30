import Link from 'next/link'
import type { Metadata } from 'next'
import { listAuditActions } from '@/lib/admin/list-audit'
import type { AuditActionRow } from '@/lib/admin/list-audit'

export const metadata: Metadata = {
  title: 'Audit — Admin',
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

const TARGET_TYPE_OPTIONS = ['post', 'comment', 'user', 'tag', 'report']

interface PageSearchParams {
  actor?: string
  target_type?: string
  cursor?: string
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>
}) {
  const sp = await searchParams
  const actor = sp?.actor?.trim() ?? undefined
  const target_type = sp?.target_type?.trim() ?? undefined
  const cursor = sp?.cursor ?? null

  const { rows, nextCursor } = await listAuditActions(
    { actor: actor || undefined, target_type: target_type || undefined, cursor },
    50,
  )

  // Build base URL preserving current filters (minus cursor)
  function buildHref(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams()
    if (actor) params.set('actor', actor)
    if (target_type) params.set('target_type', target_type)
    for (const [k, v] of Object.entries(overrides)) {
      if (v) params.set(k, v)
      else params.delete(k)
    }
    const qs = params.toString()
    return `/admin/audit${qs ? `?${qs}` : ''}`
  }

  return (
    <section>
      <h2 className="font-mono text-lg font-semibold mb-4">Mod actions audit</h2>

      {/* Filter form */}
      <form action="/admin/audit" method="get" className="mb-6 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="actor" className="text-xs text-fg-subtle">
            Actor user ID
          </label>
          <input
            id="actor"
            type="text"
            name="actor"
            defaultValue={actor ?? ''}
            placeholder="UUID"
            className="border border-border rounded px-2 py-1 text-xs w-56"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="target_type" className="text-xs text-fg-subtle">
            Target type
          </label>
          <select
            id="target_type"
            name="target_type"
            defaultValue={target_type ?? ''}
            className="border border-border rounded px-2 py-1 text-xs"
          >
            <option value="">All</option>
            {TARGET_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="px-3 py-1.5 text-sm border border-border rounded hover:bg-surface-raised"
        >
          Filter
        </button>

        {(actor || target_type) && (
          <Link href="/admin/audit" className="text-xs text-fg-subtle underline self-end pb-1.5">
            Clear filters
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <p className="text-fg-subtle text-sm">No audit records found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border text-fg-subtle text-xs">
                <th className="text-left py-2 pr-4 font-medium">When</th>
                <th className="text-left py-2 pr-4 font-medium">Mod</th>
                <th className="text-left py-2 pr-4 font-medium">Action</th>
                <th className="text-left py-2 pr-4 font-medium">Target type</th>
                <th className="text-left py-2 pr-4 font-medium">Target ID</th>
                <th className="text-left py-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: AuditActionRow) => (
                <tr key={row.id} className="border-b border-border last:border-0 text-xs">
                  <td className="py-2 pr-4 text-fg-subtle whitespace-nowrap">
                    <time dateTime={row.created_at}>{formatDate(row.created_at)}</time>
                  </td>
                  <td className="py-2 pr-4">
                    {row.mod_username ? (
                      <Link href={`/admin/audit?actor=${encodeURIComponent(row.mod_user_id)}`} className="underline">
                        @{row.mod_username}
                      </Link>
                    ) : (
                      <span className="text-fg-subtle font-mono text-xs">{row.mod_user_id.slice(0, 8)}…</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 font-mono">{row.action}</td>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/admin/audit?target_type=${encodeURIComponent(row.target_type)}${actor ? `&actor=${encodeURIComponent(actor)}` : ''}`}
                      className="underline text-fg-subtle hover:text-fg"
                    >
                      {row.target_type}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 font-mono text-fg-subtle">
                    {row.target_id.slice(0, 12)}…
                  </td>
                  <td className="py-2 text-fg-subtle">{row.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && (
        <div className="mt-6">
          <Link
            href={buildHref({ cursor: nextCursor })}
            className="text-sm underline text-fg-subtle hover:text-fg"
          >
            Next page
          </Link>
        </div>
      )}
    </section>
  )
}

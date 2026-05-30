import Link from 'next/link'
import type { Metadata } from 'next'
import { listUnresolvedReports } from '@/lib/admin/list-reports'
import type { ReportListRow, ReportTarget } from '@/lib/admin/list-reports'
import ReportActions from '@/components/admin/ReportActions'

export const metadata: Metadata = {
  title: 'Reports — Admin',
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

function targetLink(target: ReportTarget | null): { href: string; label: string } | null {
  if (!target) return null
  if (target.type === 'post') {
    return {
      href: `/${target.author_username}/post/${target.slug}`,
      label: target.title,
    }
  }
  if (target.type === 'comment') {
    return {
      href: `/${target.post_author_username}/post/${target.post_slug}#comments`,
      label: `Comment: "${target.excerpt}${target.excerpt.length >= 80 ? '…' : ''}"`,
    }
  }
  if (target.type === 'user') {
    return {
      href: `/${target.username}`,
      label: `@${target.username}`,
    }
  }
  return null
}

interface PageSearchParams {
  cursor?: string
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>
}) {
  const sp = await searchParams
  const cursor = sp?.cursor ?? null

  const { rows, nextCursor } = await listUnresolvedReports({ cursor, limit: 25 })

  return (
    <section>
      <h2 className="font-mono text-lg font-semibold mb-4">Unresolved reports</h2>

      {rows.length === 0 ? (
        <p className="text-fg-subtle text-sm">No unresolved reports.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((r: ReportListRow) => {
            const link = targetLink(r.target)
            return (
              <div
                key={r.id}
                className="border border-border rounded p-4 flex flex-col gap-2"
              >
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-subtle">
                  <time dateTime={r.created_at}>{formatDate(r.created_at)}</time>
                  <span>
                    Reporter:{' '}
                    {r.reporter_username ? (
                      <Link href={`/${r.reporter_username}`} className="underline">
                        @{r.reporter_username}
                      </Link>
                    ) : (
                      <span className="italic">unknown</span>
                    )}
                  </span>
                  <span className="capitalize">Type: {r.target_type}</span>
                </div>

                <div className="text-sm">
                  {link ? (
                    <Link href={link.href} className="underline text-fg" target="_blank">
                      {link.label}
                    </Link>
                  ) : (
                    <span className="text-fg-subtle italic">Target not found (id: {r.target_id})</span>
                  )}
                </div>

                <div className="text-sm">
                  <span className="text-fg-subtle text-xs">Reason: </span>
                  {r.reason}
                </div>

                <ReportActions report={r} />
              </div>
            )
          })}
        </div>
      )}

      {nextCursor && (
        <div className="mt-6">
          <Link
            href={`/admin/reports?cursor=${encodeURIComponent(nextCursor)}`}
            className="text-sm underline text-fg-subtle hover:text-fg"
          >
            Next page
          </Link>
        </div>
      )}
    </section>
  )
}

import Link from 'next/link'
import type { Metadata } from 'next'
import { listPendingTags } from '@/lib/admin/list-tags'
import type { PendingTagRow } from '@/lib/admin/list-tags'
import TagActions from '@/components/admin/TagActions'

export const metadata: Metadata = {
  title: 'Tags — Admin',
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

function formatDate(iso: string) {
  return DATE_FMT.format(new Date(iso))
}

interface PageSearchParams {
  cursor?: string
}

export default async function AdminTagsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>
}) {
  const sp = await searchParams
  const cursor = sp?.cursor ?? null

  const { rows, nextCursor } = await listPendingTags({ cursor, limit: 25 })

  return (
    <section>
      <h2 className="font-mono text-lg font-semibold mb-4">Pending tags</h2>

      {rows.length === 0 ? (
        <p className="text-fg-subtle text-sm">No pending tags.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border text-fg-subtle text-xs">
                <th className="text-left py-2 pr-4 font-medium">Slug</th>
                <th className="text-left py-2 pr-4 font-medium">Name</th>
                <th className="text-right py-2 pr-4 font-medium">Uses</th>
                <th className="text-left py-2 pr-4 font-medium">Created</th>
                <th className="text-left py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tag: PendingTagRow) => (
                <tr key={tag.slug} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4">
                    <code className="text-xs bg-surface-raised px-1 rounded">{tag.slug}</code>
                  </td>
                  <td className="py-3 pr-4">{tag.name}</td>
                  <td className="py-3 pr-4 text-right text-fg-subtle">{tag.usage_count}</td>
                  <td className="py-3 pr-4 text-fg-subtle text-xs">
                    <time dateTime={tag.created_at}>{formatDate(tag.created_at)}</time>
                  </td>
                  <td className="py-3">
                    <TagActions tag={tag} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && (
        <div className="mt-6">
          <Link
            href={`/admin/tags?cursor=${encodeURIComponent(nextCursor)}`}
            className="text-sm underline text-fg-subtle hover:text-fg"
          >
            Next page
          </Link>
        </div>
      )}
    </section>
  )
}

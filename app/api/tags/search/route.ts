/**
 * GET /api/tags/search
 *
 * Returns approved tags from public.tags. Anonymous-safe: the route only
 * ever returns rows with is_approved = true, so there is no PII or moderation
 * surface to leak.
 *
 * Query params:
 *   q  - optional prefix to match against slug or name (ILIKE 'q%'). Empty or
 *        absent → returns the first 50 approved tags by alphabetical order.
 *
 * Response: { tags: { slug, name, parent_tag_slug }[] }
 *
 * The response is cached at the edge (s-maxage=60 / SWR=300) — tags change
 * infrequently and the picker can tolerate up to a minute of staleness.
 */
import type { NextRequest } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { logRouteError } from '@/lib/logging/error-log'

export const runtime = 'nodejs'

const LIMIT = 50

function json(
  status: number,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  })
}

export async function GET(req: NextRequest | Request): Promise<Response> {
  const url = new URL(req.url)
  const qRaw = url.searchParams.get('q')
  const q = qRaw?.trim() ?? ''

  const supabase = createAdminSupabaseClient()
  let builder = supabase
    .from('tags')
    .select('slug, name, parent_tag_slug')
    .eq('is_approved', true)

  if (q.length > 0) {
    // Escape the LIKE wildcards in user input so '%' and '_' don't broaden
    // the search beyond what they typed.
    const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`)
    const pattern = `${escaped}%`
    builder = builder.or(`slug.ilike.${pattern},name.ilike.${pattern}`)
  }

  // PostgREST rejects `nulls=first` on a column not part of the SELECT in some
  // setups, and chaining two `.order()` calls when one column is nullable has
  // bitten this codebase before. Order by slug only — the parent-first
  // grouping is a display concern that the picker can do client-side.
  const { data, error } = await builder
    .order('slug', { ascending: true })
    .limit(LIMIT)

  if (error) {
    logRouteError(error, {
      route: '/api/tags/search',
      extra: {
        code: error.code,
        details: error.details,
        hint: error.hint,
      },
    })
    return json(500, { error: 'query_failed', detail: error.message })
  }

  return json(
    200,
    { tags: data ?? [] },
    { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' },
  )
}

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
 *        Capped at 64 characters; longer values are rejected with 400.
 *
 * Response: { tags: { slug, name, parent_tag_slug }[] }
 *
 * The response is cached at the edge (s-maxage=60 / SWR=300) — tags change
 * infrequently and the picker can tolerate up to a minute of staleness.
 *
 * Security note (H2): the previous implementation interpolated `q` (after
 * LIKE-escaping) into a single PostgREST `.or()` string. PostgREST parses
 * `.or()` as comma-separated predicates, so an unescaped `,` or `.` in `q`
 * could inject extra predicates. We now run the slug-prefix and name-prefix
 * lookups as two separate `.ilike()` queries and merge them in the route,
 * which removes the metacharacter surface entirely.
 */
import type { NextRequest } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { logRouteError } from '@/lib/logging/error-log'

export const runtime = 'nodejs'

const LIMIT = 50
const MAX_Q_LENGTH = 64

type TagRow = { slug: string; name: string; parent_tag_slug: string | null }

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

  if (q.length > MAX_Q_LENGTH) {
    return json(400, { error: 'query_too_long' })
  }

  const supabase = createAdminSupabaseClient()

  // No filter: alphabetical first page.
  if (q.length === 0) {
    const { data, error } = await supabase
      .from('tags')
      .select('slug, name, parent_tag_slug')
      .eq('is_approved', true)
      .order('slug', { ascending: true })
      .limit(LIMIT)

    if (error) {
      logRouteError(error, {
        route: '/api/tags/search',
        extra: { code: error.code, details: error.details, hint: error.hint },
      })
      return json(500, { error: 'query_failed', detail: error.message })
    }

    return json(
      200,
      { tags: data ?? [] },
      { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' },
    )
  }

  // Escape LIKE wildcards in user input so '%' and '_' don't broaden the
  // search beyond what they typed. We do NOT need to escape PostgREST
  // metacharacters (',', '.', '(', ')') here because the value is passed as
  // an argument to `.ilike()` rather than spliced into a multi-clause `.or()`
  // string — the supabase-js builder URL-encodes it as a single predicate
  // value, not a parser-level token list.
  const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`)
  const pattern = `${escaped}%`

  const [slugResult, nameResult] = await Promise.all([
    supabase
      .from('tags')
      .select('slug, name, parent_tag_slug')
      .eq('is_approved', true)
      .ilike('slug', pattern)
      .order('slug', { ascending: true })
      .limit(LIMIT),
    supabase
      .from('tags')
      .select('slug, name, parent_tag_slug')
      .eq('is_approved', true)
      .ilike('name', pattern)
      .order('slug', { ascending: true })
      .limit(LIMIT),
  ])

  const firstError = slugResult.error ?? nameResult.error
  if (firstError) {
    logRouteError(firstError, {
      route: '/api/tags/search',
      extra: {
        code: firstError.code,
        details: firstError.details,
        hint: firstError.hint,
      },
    })
    return json(500, { error: 'query_failed', detail: firstError.message })
  }

  // Merge, dedupe by slug, sort, cap.
  const bySlug = new Map<string, TagRow>()
  for (const row of (slugResult.data ?? []) as TagRow[]) bySlug.set(row.slug, row)
  for (const row of (nameResult.data ?? []) as TagRow[]) {
    if (!bySlug.has(row.slug)) bySlug.set(row.slug, row)
  }
  const merged = Array.from(bySlug.values())
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .slice(0, LIMIT)

  return json(
    200,
    { tags: merged },
    { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' },
  )
}

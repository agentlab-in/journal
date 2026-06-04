import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_SUFFIX = 99
const MAX_SLUG_ATTEMPTS = 3

export async function findUniqueSlug(
  db: Pick<SupabaseClient, 'from'>,
  authorId: string,
  baseSlug: string,
): Promise<string> {
  const candidates = [
    baseSlug,
    ...Array.from({ length: MAX_SUFFIX - 1 }, (_, i) => `${baseSlug}-${i + 2}`),
  ]
  const { data, error } = await db
    .from('posts')
    .select('slug')
    .eq('author_id', authorId)
    .in('slug', candidates)

  if (error) throw new Error(`slug lookup failed: ${error.message}`)
  const taken = new Set((data ?? []).map((r: { slug: string }) => r.slug))
  const free = candidates.find((c) => !taken.has(c))
  if (!free) {
    throw new Error(`Exhausted slug suffixes for "${baseSlug}"`)
  }
  return free
}

/**
 * Wrap a slug-using INSERT with retry-on-collision.
 *
 * `findUniqueSlug` is a SELECT-then-INSERT pattern, so two concurrent
 * draft creates with the same (author_id, base_slug) can both observe the
 * slug as free and then race on INSERT. The loser gets a Postgres
 * unique-violation (SQLSTATE 23505). This helper catches that specific
 * error, recomputes the slug, and retries up to MAX_SLUG_ATTEMPTS times.
 *
 * Usage:
 *   const post = await withSlugRetry(
 *     () => findUniqueSlug(db, authorId, baseSlug),
 *     (slug) => db.from('posts').insert({ ..., slug }).select(...).single(),
 *   )
 *
 * The `insert` callback receives the candidate slug and returns the raw
 * Supabase result (`{ data, error }`). When `error.code === '23505'`, we
 * retry; any other error is returned to the caller unchanged. After
 * exhausting attempts we throw — at that point a third concurrent writer
 * is extraordinarily unlikely and most likely indicates a real bug.
 */
export async function withSlugRetry<T>(
  computeSlug: () => Promise<string>,
  insert: (slug: string) => Promise<{
    data: T | null
    error: { code?: string; message: string } | null
  }>,
): Promise<{ data: T | null; error: { code?: string; message: string } | null }> {
  let lastResult: { data: T | null; error: { code?: string; message: string } | null } = {
    data: null,
    error: null,
  }
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = await computeSlug()
    const result = await insert(slug)
    if (!result.error) return result
    if (result.error.code !== '23505') return result
    lastResult = result
  }
  throw new Error(
    `slug insert failed after ${MAX_SLUG_ATTEMPTS} attempts: ${lastResult.error?.message ?? 'unknown'}`,
  )
}

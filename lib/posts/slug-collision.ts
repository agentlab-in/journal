import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_SUFFIX = 99

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

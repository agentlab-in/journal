import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { isReserved } from '@/lib/reserved-names'

export type SlugCollisionReason = 'reserved' | 'username_taken' | 'org_slug_taken'

/**
 * Preflight check for the shared <username>/<org-slug> namespace.
 *
 * This is a TOCTOU check — between this call and a subsequent INSERT, another
 * writer could claim the slug. `public.users.username UNIQUE` and `public.orgs.slug
 * UNIQUE` remain the per-table source of truth; cross-table collisions during the
 * race window are accepted (mitigated by serial admin-driven org-create flow).
 *
 * Soft-deleted orgs still own their slug (do not filter `deleted_at IS NULL`).
 */
export async function checkSlugCollision(slug: string): Promise<SlugCollisionReason | null> {
  const normalized = slug.toLowerCase()
  if (isReserved(normalized)) return 'reserved'

  const supabase = createAdminSupabaseClient()

  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('username', normalized)
    .maybeSingle()
  if (user) return 'username_taken'

  const { data: org } = await supabase
    .from('orgs')
    .select('id')
    .eq('slug', normalized)
    .maybeSingle()
  if (org) return 'org_slug_taken'

  return null
}

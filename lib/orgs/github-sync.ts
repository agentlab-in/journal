/**
 * Phase 11.5 — Sync a user's GitHub org memberships into public.orgs +
 * public.org_members at sign-in time.
 *
 * GitHub is the source of truth: this function fetches /user/orgs with the
 * just-issued OAuth access token, materializes a public.orgs row per active
 * GitHub org (keyed by github_org_id so renames don't fork a duplicate row),
 * and reconciles public.org_members so a user only belongs to the orgs they
 * are *currently* a member of on GitHub.
 *
 * Fail-soft: any GitHub fetch or Supabase write error is logged via
 * console.error (matching lib/auth.ts convention) but never thrown — the
 * caller wraps in try/catch, but we don't want a transient blip to surface
 * "added: []" mistakes in callers either, so on a fetch failure we return
 * the zero-value tuple and skip the whole reconciliation. The next sign-in
 * will repair.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminSupabaseClient = SupabaseClient<any, any, any>

interface GithubOrg {
  id: number
  login: string
  avatar_url?: string | null
  description?: string | null
  name?: string | null
}

interface OrgRowMinimal {
  id: string
  slug: string
  github_org_id: number | null
  deleted_at: string | null
  banned_at: string | null
}

const GITHUB_ORGS_URL = 'https://api.github.com/user/orgs'
const FETCH_TIMEOUT_MS = 5_000

/**
 * Fetch the GitHub orgs the access token's user belongs to. Returns null on
 * any failure (timeout, non-2xx, non-array body) so the caller can short-
 * circuit the reconciliation cleanly.
 */
async function fetchGithubOrgs(token: string): Promise<GithubOrg[] | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(GITHUB_ORGS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'agentlab-in',
      },
      signal: controller.signal,
    })
    if (!res.ok) {
      console.error('[orgs/github-sync] GitHub /user/orgs non-2xx:', res.status)
      return null
    }
    const body: unknown = await res.json()
    if (!Array.isArray(body)) {
      console.error('[orgs/github-sync] GitHub /user/orgs body not an array')
      return null
    }
    const orgs: GithubOrg[] = []
    for (const entry of body) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      if (typeof e.id !== 'number' || typeof e.login !== 'string') continue
      orgs.push({
        id: e.id,
        login: e.login,
        avatar_url: typeof e.avatar_url === 'string' ? e.avatar_url : null,
        description: typeof e.description === 'string' ? e.description : null,
        name: typeof e.name === 'string' ? e.name : null,
      })
    }
    return orgs
  } catch (err) {
    console.error('[orgs/github-sync] GitHub fetch threw:', err)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Materialize the public.orgs row for a single GitHub org. Tries the canonical
 * github_org_id key first, then falls back to slug (legacy / manually seeded
 * rows that haven't been attached yet), and finally inserts a fresh row.
 *
 * Returns null when the org should be skipped this run (soft-deleted, banned,
 * slug-collision with an unrelated attached row, or a Supabase error on the
 * lookup/write path — every error is already console.error'd here).
 */
async function reconcileOrg(
  supabase: AdminSupabaseClient,
  userId: string,
  gh: GithubOrg,
): Promise<{ orgId: string; orgInserted: boolean } | null> {
  const slug = gh.login.toLowerCase()
  const displayName = gh.name ?? gh.login
  const bio = gh.description ?? null
  const avatar = gh.avatar_url ?? null

  try {
    // 1. Look up by github_org_id first — this is the canonical key.
    const { data: byGhId, error: byGhIdErr } = await supabase
      .from('orgs')
      .select('id, slug, github_org_id, deleted_at, banned_at')
      .eq('github_org_id', gh.id)
      .maybeSingle<OrgRowMinimal>()
    if (byGhIdErr) {
      console.error('[orgs/github-sync] lookup by github_org_id failed:', byGhIdErr.message)
      return null
    }

    if (byGhId) {
      if (byGhId.deleted_at !== null || byGhId.banned_at !== null) {
        // Skip — don't resurrect a moderated org, don't insert membership.
        return null
      }
      // Active: refresh metadata in place so renames + profile edits land.
      const { error: updErr } = await supabase
        .from('orgs')
        .update({
          slug,
          display_name: displayName,
          bio,
          avatar_url: avatar,
        })
        .eq('id', byGhId.id)
      if (updErr) {
        console.error('[orgs/github-sync] update existing org failed:', updErr.message)
      }
      return { orgId: byGhId.id, orgInserted: false }
    }

    // 2. Not found by gh id — try by slug for collision with a legacy row.
    const { data: bySlug, error: bySlugErr } = await supabase
      .from('orgs')
      .select('id, slug, github_org_id, deleted_at, banned_at')
      .eq('slug', slug)
      .maybeSingle<OrgRowMinimal>()
    if (bySlugErr) {
      console.error('[orgs/github-sync] lookup by slug failed:', bySlugErr.message)
      return null
    }

    if (bySlug) {
      if (bySlug.deleted_at !== null || bySlug.banned_at !== null) {
        return null
      }
      if (bySlug.github_org_id !== null && bySlug.github_org_id !== gh.id) {
        // Slug held by an unrelated already-attached row. Shouldn't happen
        // under UNIQUE(github_org_id) + UNIQUE(slug) but be defensive.
        console.error(
          '[orgs/github-sync] slug collision: existing row attached to different github_org_id',
          { slug, existing: bySlug.github_org_id, incoming: gh.id },
        )
        return null
      }
      // Active row holding the slug with no github_org_id → attach.
      const { error: attachErr } = await supabase
        .from('orgs')
        .update({
          github_org_id: gh.id,
          display_name: displayName,
          bio,
          avatar_url: avatar,
        })
        .eq('id', bySlug.id)
      if (attachErr) {
        console.error('[orgs/github-sync] attach legacy row failed:', attachErr.message)
        return null
      }
      return { orgId: bySlug.id, orgInserted: false }
    }

    // 3. Neither lookup matched → insert a fresh org row.
    const { data: inserted, error: insErr } = await supabase
      .from('orgs')
      .insert({
        slug,
        display_name: displayName,
        bio,
        avatar_url: avatar,
        created_by_user_id: userId,
        github_org_id: gh.id,
      })
      .select('id')
      .maybeSingle<{ id: string }>()
    if (insErr || !inserted) {
      console.error(
        '[orgs/github-sync] insert org failed:',
        insErr?.message ?? 'no row returned',
      )
      return null
    }
    return { orgId: inserted.id, orgInserted: true }
  } catch (err) {
    console.error('[orgs/github-sync] org reconcile threw:', err)
    return null
  }
}

/**
 * Delete this user's memberships in GitHub-backed orgs they no longer belong
 * to on GitHub. Memberships in orgs without a github_org_id (legacy / manually
 * seeded) are left alone. Returns the slugs (or stringified gh ids as a last
 * resort) that were removed, for the caller's report tuple.
 */
async function pruneStaleMemberships(
  supabase: AdminSupabaseClient,
  userId: string,
  activeGithubOrgIds: Set<number>,
): Promise<string[]> {
  const removed: string[] = []
  try {
    const { data: existing, error: existingErr } = await supabase
      .from('org_members')
      .select('org_id, orgs(github_org_id, slug)')
      .eq('user_id', userId)
    if (existingErr) {
      console.error('[orgs/github-sync] existing-memberships read failed:', existingErr.message)
      return removed
    }
    if (!Array.isArray(existing)) return removed

    // Supabase's typed return for an embedded relation is shaped as an array
    // even on a single-FK join; normalize via `unknown` to a flexible shape.
    const rows = existing as unknown as Array<{
      org_id: string
      orgs:
        | { github_org_id: number | null; slug: string }
        | Array<{ github_org_id: number | null; slug: string }>
        | null
    }>
    for (const row of rows) {
      const joined = Array.isArray(row.orgs) ? (row.orgs[0] ?? null) : row.orgs
      const ghId = joined?.github_org_id ?? null
      if (ghId === null) continue // legacy / manual — never prune
      if (activeGithubOrgIds.has(ghId)) continue // still a member on GitHub
      const { error: delErr } = await supabase
        .from('org_members')
        .delete()
        .eq('org_id', row.org_id)
        .eq('user_id', userId)
      if (delErr) {
        console.error('[orgs/github-sync] membership delete failed:', delErr.message)
        continue
      }
      removed.push(joined?.slug ?? String(ghId))
    }
  } catch (err) {
    console.error('[orgs/github-sync] prune threw:', err)
  }
  return removed
}

/**
 * Reconcile a user's GitHub org memberships against `public.orgs` +
 * `public.org_members`. Called once per sign-in from `events.signIn`.
 *
 * Return shape:
 * - `added`: lowercased org logins this run made newly visible to the user —
 *   either because the org row itself was inserted, OR because the user joined
 *   a pre-existing org row for the first time. (Both are "new to this user.")
 * - `removed`: lowercased org slugs whose membership row this run pruned.
 * - `total`: count of active GitHub orgs the user belongs to after sync.
 */
export async function syncUserGithubOrgs(opts: {
  supabase: AdminSupabaseClient
  userId: string
  githubAccessToken: string
}): Promise<{ added: string[]; removed: string[]; total: number }> {
  const { supabase, userId, githubAccessToken } = opts

  console.info('[orgs/github-sync] sync starting for user', userId)
  const ghOrgs = await fetchGithubOrgs(githubAccessToken)
  if (ghOrgs === null) {
    console.warn('[orgs/github-sync] fetchGithubOrgs returned null — aborting sync')
    return { added: [], removed: [], total: 0 }
  }
  console.info(
    '[orgs/github-sync] GitHub returned',
    ghOrgs.length,
    'orgs:',
    ghOrgs.map((o) => o.login),
  )

  const added = new Set<string>()
  const activeOrgIds: string[] = []
  // Set of gh-ids that wound up active in the DB this run.
  const activeGhIds = new Set<number>()

  for (const gh of ghOrgs) {
    const slug = gh.login.toLowerCase()
    const reconciled = await reconcileOrg(supabase, userId, gh)
    if (!reconciled) continue
    const { orgId, orgInserted } = reconciled
    if (orgInserted) added.add(slug)
    activeOrgIds.push(orgId)
    activeGhIds.add(gh.id)

    // Membership upsert — idempotent via ON CONFLICT DO NOTHING. Check first
    // so we can populate `added` accurately for users who are new to a reused
    // org row.
    try {
      const { data: existingMember } = await supabase
        .from('org_members')
        .select('user_id')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .maybeSingle<{ user_id: string }>()

      if (!existingMember) {
        const { error: upErr } = await supabase.from('org_members').upsert(
          {
            org_id: orgId,
            user_id: userId,
            role: 'member',
            added_at: new Date().toISOString(),
          },
          { onConflict: 'org_id,user_id', ignoreDuplicates: true },
        )
        if (upErr) {
          console.error('[orgs/github-sync] membership upsert failed:', upErr.message)
        } else {
          added.add(slug)
        }
      }
    } catch (err) {
      console.error('[orgs/github-sync] membership upsert threw:', err)
    }
  }

  const removed = await pruneStaleMemberships(supabase, userId, activeGhIds)

  return {
    added: Array.from(added),
    removed,
    total: activeOrgIds.length,
  }
}

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

export async function syncUserGithubOrgs(opts: {
  supabase: AdminSupabaseClient
  userId: string
  githubAccessToken: string
}): Promise<{ added: string[]; removed: string[]; total: number }> {
  const { supabase, userId, githubAccessToken } = opts

  const ghOrgs = await fetchGithubOrgs(githubAccessToken)
  if (ghOrgs === null) {
    return { added: [], removed: [], total: 0 }
  }

  const added = new Set<string>()
  const activeOrgIds: string[] = []
  // Track gh-id -> login for prune reporting.
  const ghIdToLogin = new Map<number, string>()
  // Set of gh-ids that wound up active in the DB this run.
  const activeGhIds = new Set<number>()

  for (const gh of ghOrgs) {
    const slug = gh.login.toLowerCase()
    const displayName = gh.name ?? gh.login
    const bio = gh.description ?? null
    const avatar = gh.avatar_url ?? null
    ghIdToLogin.set(gh.id, slug)

    // 1. Look up by github_org_id first — this is the canonical key.
    let orgId: string | null = null
    let didInsert = false
    try {
      const { data: byGhId, error: byGhIdErr } = await supabase
        .from('orgs')
        .select('id, slug, github_org_id, deleted_at, banned_at')
        .eq('github_org_id', gh.id)
        .maybeSingle<OrgRowMinimal>()
      if (byGhIdErr) {
        console.error('[orgs/github-sync] lookup by github_org_id failed:', byGhIdErr.message)
        continue
      }

      if (byGhId) {
        if (byGhId.deleted_at !== null || byGhId.banned_at !== null) {
          // Skip — don't resurrect a moderated org, don't insert membership.
          continue
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
        orgId = byGhId.id
      } else {
        // 2. Not found by gh id — try by slug for collision with a legacy row.
        const { data: bySlug, error: bySlugErr } = await supabase
          .from('orgs')
          .select('id, slug, github_org_id, deleted_at, banned_at')
          .eq('slug', slug)
          .maybeSingle<OrgRowMinimal>()
        if (bySlugErr) {
          console.error('[orgs/github-sync] lookup by slug failed:', bySlugErr.message)
          continue
        }

        if (bySlug) {
          if (bySlug.deleted_at !== null || bySlug.banned_at !== null) {
            continue
          }
          if (bySlug.github_org_id !== null && bySlug.github_org_id !== gh.id) {
            // Slug held by an unrelated already-attached row. Shouldn't happen
            // under UNIQUE(github_org_id) + UNIQUE(slug) but be defensive.
            console.error(
              '[orgs/github-sync] slug collision: existing row attached to different github_org_id',
              { slug, existing: bySlug.github_org_id, incoming: gh.id },
            )
            continue
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
            continue
          }
          orgId = bySlug.id
        } else {
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
            continue
          }
          orgId = inserted.id
          didInsert = true
          added.add(slug)
        }
      }
    } catch (err) {
      console.error('[orgs/github-sync] org reconcile threw:', err)
      continue
    }

    if (!orgId) continue
    activeOrgIds.push(orgId)
    activeGhIds.add(gh.id)

    // 4. Membership upsert — idempotent via ON CONFLICT DO NOTHING.
    try {
      // Check if the membership row already exists so we can populate `added`
      // accurately (the org itself may be reused but this user might be new
      // to it, and vice versa).
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
      } else if (didInsert) {
        // Org was new but membership already existed — extremely unlikely but
        // keep `added` honest: it was already tracked above.
      }
    } catch (err) {
      console.error('[orgs/github-sync] membership upsert threw:', err)
    }
  }

  // 5. Prune stale memberships. Pull this user's existing memberships joined
  // to orgs.github_org_id; delete the ones whose gh id is NOT in activeGhIds.
  // Memberships to orgs without github_org_id (legacy / manually seeded) are
  // left alone.
  const removed: string[] = []
  try {
    const { data: existing, error: existingErr } = await supabase
      .from('org_members')
      .select('org_id, orgs(github_org_id, slug)')
      .eq('user_id', userId)
    if (existingErr) {
      console.error('[orgs/github-sync] existing-memberships read failed:', existingErr.message)
    } else if (Array.isArray(existing)) {
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
        if (activeGhIds.has(ghId)) continue // still a member on GitHub
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
    }
  } catch (err) {
    console.error('[orgs/github-sync] prune threw:', err)
  }

  return {
    added: Array.from(added),
    removed,
    total: activeOrgIds.length,
  }
}

import { z } from 'zod'

/**
 * Zod-validated environment access.
 *
 * Phase 0: NODE_ENV only.
 * Phase 1: NextAuth + GitHub OAuth + Supabase vars added below.
 *
 * Schema-level: most Phase 1 vars are `.optional()` so `pnpm typecheck`,
 * `pnpm test`, and `pnpm build` work in CI without real secrets.
 *
 * Production-level: after parsing, when `NODE_ENV === 'production'` we
 * additionally enforce that NEXTAUTH_SECRET (≥32 chars) and
 * ADMIN_GITHUB_LOGINS (≥1 entry) are present. Missing values throw at
 * import time, which fails fast on cold boot rather than at the first
 * auth request.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),

  // NextAuth
  NEXTAUTH_SECRET: z.string().min(1).optional(),
  NEXTAUTH_URL: z.string().min(1).optional(),

  // GitHub OAuth
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),

  // Supabase — public vars (available on both server and client)
  NEXT_PUBLIC_SUPABASE_URL: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),

  // Supabase — server-only (service-role, never sent to browser)
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // Admin allowlist — Phase 12 scaffold; comma-separated GitHub logins
  ADMIN_GITHUB_LOGINS: z.string().optional(),

  // Phase 14 — Rate limiting (Upstash Redis REST). Both optional; missing
  // values fall back to an in-memory sliding window (see lib/rate-limit.ts).
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

  // Canonical site origin used for sitemap/robots/OG absolute URLs. Optional
  // — lib/site-url.ts falls back to https://agentlab.in when unset.
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
})

export const env = envSchema.parse(process.env)

/**
 * Parsed admin GitHub login allowlist (lowercased, trimmed, empty entries
 * dropped). Authoritative for "is this user an admin?" — callers should use
 * `ADMIN_GITHUB_LOGINS` instead of re-splitting `env.ADMIN_GITHUB_LOGINS`.
 */
export const ADMIN_GITHUB_LOGINS: ReadonlyArray<string> = (
  env.ADMIN_GITHUB_LOGINS ?? ''
)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s.length > 0)

if (env.NODE_ENV === 'production') {
  const missing: string[] = []
  if (!env.NEXTAUTH_SECRET || env.NEXTAUTH_SECRET.length < 32) {
    missing.push('NEXTAUTH_SECRET (must be ≥32 chars)')
  }
  if (ADMIN_GITHUB_LOGINS.length === 0) {
    missing.push('ADMIN_GITHUB_LOGINS (must list ≥1 GitHub login)')
  }
  if (missing.length > 0) {
    throw new Error(
      `Production env validation failed. Missing or invalid: ${missing.join(', ')}.`,
    )
  }
}

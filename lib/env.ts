import { z } from 'zod'

/**
 * Zod-validated environment access.
 *
 * Phase 0: NODE_ENV only.
 * Phase 1: NextAuth + GitHub OAuth + Supabase vars added below.
 *
 * All Phase 1 vars are optional in the schema so that
 * `pnpm typecheck && pnpm test && pnpm build` work in CI without secrets.
 * A runtime error is thrown at the point of use if a required var is absent
 * in production (see lib/auth.ts, lib/supabase/*.ts).
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
})

export const env = envSchema.parse(process.env)

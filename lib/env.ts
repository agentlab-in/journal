import { z } from 'zod'

/**
 * Zod-validated environment access.
 *
 * Phase 0 schema: only NODE_ENV.
 * Future phases: extend `envSchema` below with new variables, e.g.:
 *   NEXTAUTH_SECRET: z.string().min(1),
 *   NEXTAUTH_URL: z.string().url(),
 *   GITHUB_CLIENT_ID: z.string().min(1),
 *   GITHUB_CLIENT_SECRET: z.string().min(1),
 *   NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
})

export const env = envSchema.parse(process.env)

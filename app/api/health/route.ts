/**
 * GET /api/health
 *
 * Liveness + DB-reachability probe for external uptime monitors. No auth,
 * no rate-limit, no origin check — the endpoint is intentionally accessible
 * from anywhere so a status page can poll it.
 *
 * Response shape:
 *   200 { ok: true,  db: 'ok'   } — DB query succeeded
 *   503 { ok: false, db: 'down' } — DB query errored or threw
 *
 * The DB ping uses the anon Supabase client against `public.posts` (which
 * has a public-read RLS policy filtered to `deleted_at IS NULL`). This
 * exercises the real anon path: an RLS misconfig, DB outage, or table
 * drop all surface here. No service-role key is touched.
 */
import { createAnonServerSupabaseClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  let db: 'ok' | 'down' = 'ok'
  try {
    const anon = createAnonServerSupabaseClient()
    const { error } = await anon.from('posts').select('id').limit(1)
    if (error) db = 'down'
  } catch {
    db = 'down'
  }
  return new Response(JSON.stringify({ ok: db === 'ok', db }), {
    status: db === 'ok' ? 200 : 503,
    headers: { 'Content-Type': 'application/json' },
  })
}

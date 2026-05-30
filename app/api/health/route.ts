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
 * The DB ping is a trivial `select id from users limit 1` so an outage
 * (network, RLS misconfig, table dropped) surfaces here. We never read row
 * data — only the error channel matters.
 */
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  let db: 'ok' | 'down' = 'ok'
  try {
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('users').select('id').limit(1)
    if (error) db = 'down'
  } catch {
    db = 'down'
  }
  return new Response(JSON.stringify({ ok: db === 'ok', db }), {
    status: db === 'ok' ? 200 : 503,
    headers: { 'Content-Type': 'application/json' },
  })
}

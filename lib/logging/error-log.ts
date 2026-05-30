/**
 * Phase 14 — Structured route error logger.
 *
 * Emits a single JSON line per error to console.error so log aggregators
 * (Vercel, Logflare, etc.) can parse them without regex. Replaces the
 * existing `console.error('[scope] msg:', err)` pattern in API routes.
 *
 * Never throws — stringification failures (circular refs, etc.) fall back
 * to a sentinel record so a logging bug cannot mask the original error.
 */

export interface ErrorLogContext {
  route: string
  /**
   * Distinguishes:
   *   undefined — no user info available, omit field entirely
   *   null      — anonymous request (no session)
   *   string    — authenticated user id
   */
  userId?: string | null
  extra?: Record<string, unknown>
}

interface ErrorShape {
  name: string
  message: string
  stack: string | null
}

function shapeError(err: unknown): ErrorShape {
  if (err instanceof Error) {
    return {
      name: err.name || 'Error',
      message: err.message,
      stack: err.stack ?? null,
    }
  }
  // Intentionally NOT wrapped in try/catch — circular refs propagate up to
  // the outer try in logRouteError so the sentinel record is emitted.
  const message = typeof err === 'string' ? err : JSON.stringify(err)
  return { name: 'NonError', message, stack: null }
}

export function logRouteError(err: unknown, ctx: ErrorLogContext): void {
  const ts = new Date().toISOString()
  try {
    const record: Record<string, unknown> = {
      ts,
      route: ctx.route,
      ...(ctx.extra ?? {}),
      err: shapeError(err),
    }
    if (ctx.userId !== undefined) {
      record.user_id = ctx.userId
    }
    console.error(JSON.stringify(record))
  } catch {
    console.error(
      JSON.stringify({ ts, route: ctx.route, log_error: 'stringify_failed' }),
    )
  }
}

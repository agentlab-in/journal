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

/**
 * Keys (case-insensitive, full key name) whose values are replaced with
 * `'[REDACTED]'` when spread from `ctx.extra` into the log record.
 *
 * Matches the obvious credential families plus PII the GDPR/DPDP regimes
 * treat as identifying: bare `email`, `ip` / `ip_address` / `remote_addr`.
 * Examples of matches: authorization, Authorization, auth_token,
 * accessToken, password, cookies, api_key, apiKey, API-KEY, userSecret,
 * email, user_email, ip, ipAddress, remote_addr.
 *
 * Callers should still avoid putting raw secrets in `ctx.extra` — this is
 * a defence-in-depth net, not a license to log credentials.
 */
const SENSITIVE_KEY_PATTERN =
  /authorization|token|secret|password|cookie|api[_-]?key|email|ip[_-]?address|remote[_-]?addr|^ip$/i

function redactExtra(
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!extra) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(extra)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : value
  }
  return out
}

/**
 * Emit a single structured JSON line for a route error to console.error.
 *
 * Redaction policy: any key in `ctx.extra` whose name matches the
 * `SENSITIVE_KEY_PATTERN` regex (credentials and bare PII like email/ip)
 * has its value replaced with the literal string `'[REDACTED]'` before
 * serialization. This guards
 * against accidental secret leaks via the spread `...ctx.extra` payload.
 * Callers must still avoid putting raw secrets in `ctx.extra` — this is
 * defence-in-depth, not a license to log credentials.
 */
export function logRouteError(err: unknown, ctx: ErrorLogContext): void {
  const ts = new Date().toISOString()
  try {
    // Canonical fields (ts, route, err, user_id) are written AFTER the spread
    // so a caller can't accidentally — or maliciously — shadow them via
    // `ctx.extra`. Without this ordering, an `extra: { route: '/spoofed' }`
    // would silently overwrite the real route in the log line.
    const record: Record<string, unknown> = {
      ...redactExtra(ctx.extra),
      ts,
      route: ctx.route,
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

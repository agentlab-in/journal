/**
 * POST /api/mdx/preview
 *
 * Compiles MDX server-side and returns the `<MDXRemote />`-ready payload.
 * The PreviewPane client component calls this debounced (300ms) on every
 * keystroke.
 *
 * Why a server route instead of a Web Worker?
 *   `next-mdx-remote/serialize` depends on `node:vm` and other Node-only
 *   primitives (it's a thin wrapper around @mdx-js/mdx + Function eval).
 *   It cannot run in a browser Web Worker. We pivot to a short-lived auth-
 *   gated server route — the compile still runs off the main thread (it
 *   runs on the server) and the editor stays responsive.
 *
 * Error contract:
 *   401 unauthorized   — no session
 *   400 invalid_json   — body wasn't valid JSON
 *   400 invalid_body   — `body_md` missing or not a string
 *   413 body_too_large — `body_md` longer than MAX_LENGTH
 *   200 { compiledSource, ... }       — successful compile
 *   422 { error: { message } }        — MDX failed to parse/compile
 *
 * The 422 path is what the PreviewPane renders inline as a "compile error"
 * banner; the 4xx validation paths surface as generic toasts.
 */
import { getSession } from '@/lib/auth'
import { compileMdx } from '@/lib/mdx/compile'
import { guardMutatingRequest } from '@/lib/route-guard'

// Route Handlers default to the Node runtime, but compileMdx hard-requires
// Node (next-mdx-remote/serialize uses node:vm). Be explicit so a future
// edge-runtime default flip doesn't silently break this endpoint.
export const runtime = 'nodejs'

/**
 * Hard cap on body size to keep the serializer cheap and protect the
 * Node process from a hostile/runaway client. 100k chars is roughly
 * a 40-page article — far beyond what we expect.
 */
export const MAX_LENGTH = 100_000

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function POST(req: Request): Promise<Response> {
  // 1. Auth
  const session = await getSession()
  if (!session?.user?.id) {
    return json(401, { error: 'unauthorized' })
  }

  // 1b. Origin + rate-limit guard. The editor debounces 300ms between
  // compile calls; the `mdx_preview` ceiling (60/min/user) sits well above
  // any honest typing cadence while shutting down a script that holds the
  // editor open and pumps the endpoint.
  const guard = await guardMutatingRequest(req, {
    userId: session.user.id,
    bucket: 'mdx_preview',
  })
  if (guard.failed) return guard.response

  // 2. Parse JSON
  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  // 3. Validate body shape
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as { body_md?: unknown }).body_md !== 'string'
  ) {
    return json(400, { error: 'invalid_body' })
  }
  const body_md = (payload as { body_md: string }).body_md

  // 4. Length cap
  if (body_md.length > MAX_LENGTH) {
    return json(413, { error: 'body_too_large' })
  }

  // 5. Compile — any MDX-parse failure becomes a user-visible 422 so the
  // preview pane can render the error message inline. We deliberately do
  // not 500 here: compile errors are part of the normal authoring loop.
  try {
    const result = await compileMdx(body_md)
    return json(200, result as unknown as Record<string, unknown>)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to compile MDX'
    return json(422, { error: { message } })
  }
}

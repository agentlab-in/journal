import { waitlistEmailSchema } from '@/lib/waitlist'

// Run on Node runtime — uses process.env at request time, not edge cache.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KIT_SUBSCRIBE_URL = (formId: string) =>
  `https://api.convertkit.com/v3/forms/${encodeURIComponent(formId)}/subscribe`

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const parsed = waitlistEmailSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid email.' },
      { status: 400 },
    )
  }

  // Migration path: when Supabase ships in Phase 2 we can either dual-write
  // (Kit + Supabase `waitlist_signups` table) or read from Kit's API. Kit stays
  // the source of truth for sending the actual launch announcement either way.
  const apiKey = process.env.KIT_API_KEY
  const formId = process.env.KIT_FORM_ID
  if (!apiKey || !formId) {
    return Response.json(
      { error: 'Waitlist temporarily unavailable. Please try again later.' },
      { status: 503 },
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const upstream = await fetch(KIT_SUBSCRIBE_URL(formId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, email: parsed.data.email }),
      signal: controller.signal,
    })

    if (!upstream.ok) {
      return Response.json(
        { error: 'Something went wrong. Please try again later.' },
        { status: 502 },
      )
    }

    return Response.json({ ok: true }, { status: 200 })
  } catch {
    return Response.json(
      { error: 'Something went wrong. Please try again later.' },
      { status: 502 },
    )
  } finally {
    clearTimeout(timeout)
  }
}

import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { PostCreateBody } from '@/lib/posts/schema'
import { slug as toSlug } from '@/lib/posts/slug'
import { isReserved } from '@/lib/reserved-names'
import { isValidCoverImageUrl } from '@/lib/posts/cover-image'
import { extractStructuredSections } from '@/lib/posts/sections'
import { extractWikilinkAnchors } from '@/lib/posts/wikilinks-extract'
import { resolveAnchor } from '@/lib/posts/wikilinks-resolve'
import { renderToHtml } from '@/lib/posts/render'
import { findUniqueSlug } from '@/lib/posts/slug-collision'
import { postUrl, type PostType } from '@/lib/posts/url'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function POST(req: NextRequest | Request): Promise<Response> {
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  const parsed = PostCreateBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    })
  }

  return json(500, { error: 'not_implemented' })
}

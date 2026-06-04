import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { PostCreateBody } from '@/lib/posts/schema'
import { slug as toSlug } from '@/lib/posts/slug'
import { isReserved } from '@/lib/reserved-names'
import { isValidCoverImageUrl } from '@/lib/posts/cover-image'
import { extractStructuredSections } from '@/lib/posts/sections'
import { extractWikilinkAnchors } from '@/lib/posts/wikilinks-extract'
import { resolveAnchors } from '@/lib/posts/wikilinks-resolve'
import { renderToHtml } from '@/lib/posts/render'
import { findUniqueSlug } from '@/lib/posts/slug-collision'
import { postUrl, type PostType } from '@/lib/posts/url'
import { guardMutatingRequest } from '@/lib/route-guard'

export const runtime = 'nodejs'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Required section keys per post type
const REQUIRED_SECTION_KEYS: Record<string, string[]> = {
  playbook: ['environment_target', 'prerequisites', 'core_instructions', 'safety_failure_modes'],
  dive: ['tldr', 'the_question'],
}

// Hard ceiling on synchronous MDX/HAST work per publish. Bounds worst-case
// CPU spent inside `renderToHtml` + `extractStructuredSections` so a
// pathological body (deep nesting, tag explosion) cannot keep a Node
// process pinned at 100% indefinitely. 10s is well above the p99 of an
// honest publish (single-digit ms) and below typical platform/edge
// function timeouts.
const RENDER_TIMEOUT_MS = 10_000

function withRenderTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('render_timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

export async function POST(req: NextRequest | Request): Promise<Response> {
  // Step 1: auth
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  // Step 1b: origin + rate-limit guard (Phase 14)
  const guard = await guardMutatingRequest(req, { bucket: 'publish', userId })
  if (guard.failed) return guard.response

  // Step 2: JSON parse
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  // Step 3: Zod parse
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

  const { type, title, summary, body_md, tags, cover_image_url } = parsed.data

  // Step 4: cover_image_url bucket validation
  if (cover_image_url !== undefined && !isValidCoverImageUrl(cover_image_url)) {
    return json(400, { error: 'invalid_cover_url' })
  }

  // Step 5: derive structured sections + required-key check for playbook/dive.
  // Wrapped in the same 10s timeout boundary as `renderToHtml` so a
  // pathological body can't pin the event loop here either.
  let structured_sections
  try {
    structured_sections = await withRenderTimeout(
      Promise.resolve().then(() =>
        extractStructuredSections(body_md, type as PostType),
      ),
      RENDER_TIMEOUT_MS,
    )
  } catch (err) {
    if (err instanceof Error && err.message === 'render_timeout') {
      return json(422, { error: 'render_timeout' })
    }
    throw err
  }
  if (type !== 'post' && structured_sections !== null) {
    const required = REQUIRED_SECTION_KEYS[type] ?? []
    const missing = required.filter(
      (k) => !structured_sections[k] || !String(structured_sections[k]).trim(),
    )
    if (missing.length > 0) {
      return json(400, { error: 'missing_sections', detail: missing.join(', ') })
    }
  }

  // Step 6: derive baseSlug + reserved check
  const baseSlug = toSlug(title)
  if (isReserved(baseSlug)) {
    return json(400, { error: 'reserved_slug' })
  }

  const admin = createAdminSupabaseClient()

  // Step 7: find unique slug (after reserved check)
  let finalSlug: string
  try {
    finalSlug = await findUniqueSlug(admin, userId, baseSlug)
  } catch (err) {
    return json(500, { error: 'slug_exhausted', detail: String(err) })
  }

  // Step 8: load author username
  const { data: userRow, error: userErr } = await admin
    .from('users')
    .select('username')
    .eq('id', userId)
    .single()

  if (userErr || !userRow) {
    return json(500, { error: 'author_not_found' })
  }
  const username = (userRow as { username: string }).username

  // Step 9: tag handling
  // Pre-fetch existing tags matching the submitted slugs
  const { data: existingTagRows, error: tagFetchErr } = await admin
    .from('tags')
    .select('slug')
    .in('slug', tags)

  if (tagFetchErr) {
    return json(500, { error: 'tag_fetch_failed', detail: tagFetchErr.message })
  }

  const existingTagSlugs = new Set(
    ((existingTagRows ?? []) as Array<{ slug: string }>).map((r) => r.slug),
  )
  const newTagSlugs = tags.filter((t) => !existingTagSlugs.has(t))

  // Reject reserved new-tag slugs
  const reservedTags = newTagSlugs.filter((t) => isReserved(t))
  if (reservedTags.length > 0) {
    return json(400, { error: 'reserved_tag_slug', detail: reservedTags.join(', ') })
  }

  // Step 10: insert new pending tags
  if (newTagSlugs.length > 0) {
    const { error: tagInsertErr } = await admin.from('tags').insert(
      newTagSlugs.map((slug) => ({
        slug,
        is_approved: false,
        approved_by: null,
        approved_at: null,
      })),
    )
    if (tagInsertErr) {
      return json(500, { error: 'tag_insert_failed', detail: tagInsertErr.message })
    }
  }

  // Step 11: extract wikilink anchors + resolve in a single batched query.
  // The extract step is bounded at MAX_WIKILINK_ANCHORS (100) — see
  // `lib/posts/wikilinks-extract.ts`. The resolve step is now one
  // `.in('slug', ...)` round-trip instead of N sequential queries, which
  // collapses publish latency on link-heavy posts.
  const anchors = extractWikilinkAnchors(body_md)
  const resolvedByAnchor = await resolveAnchors(anchors, {
    db: admin,
    currentUserId: userId,
  })
  const resolvedMap = new Map<string, string>()
  const resolvedAnchors: Array<{ anchor: string; targetPostId: string; targetSlug: string }> = []
  for (const [anchor, resolved] of resolvedByAnchor) {
    const url = postUrl(resolved.targetUsername, resolved.targetType, resolved.targetSlug)
    resolvedMap.set(anchor, url)
    resolvedAnchors.push({
      anchor,
      targetPostId: resolved.targetPostId,
      targetSlug: resolved.targetSlug,
    })
  }

  // Step 12: render to HTML under the same 10s render-timeout boundary.
  let body_html: string
  try {
    body_html = await withRenderTimeout(
      renderToHtml(body_md, {
        resolveAnchor: (a) => resolvedMap.get(a) ?? null,
      }),
      RENDER_TIMEOUT_MS,
    )
  } catch (err) {
    if (err instanceof Error && err.message === 'render_timeout') {
      return json(422, { error: 'render_timeout' })
    }
    throw err
  }

  // Step 13: insert posts row
  const { data: postRow, error: postInsertErr } = await admin
    .from('posts')
    .insert({
      author_id: userId,
      type,
      slug: finalSlug,
      title,
      summary,
      body_md,
      body_html,
      structured_sections: structured_sections ?? null,
      cover_image_url: cover_image_url ?? null,
    })
    .select('id')
    .single()

  if (postInsertErr || !postRow) {
    return json(500, { error: 'post_insert_failed', detail: postInsertErr?.message })
  }
  const postId = (postRow as { id: string }).id

  // Step 14: insert post_tags
  const { error: postTagsErr } = await admin.from('post_tags').insert(
    tags.map((tag_slug) => ({ post_id: postId, tag_slug })),
  )
  if (postTagsErr) {
    return json(500, { error: 'post_tags_insert_failed', detail: postTagsErr.message })
  }

  // Step 15: insert post_versions (version_no=1)
  const { error: versionsErr } = await admin.from('post_versions').insert([
    { post_id: postId, version_no: 1, body_md },
  ])
  if (versionsErr) {
    return json(500, { error: 'post_versions_insert_failed', detail: versionsErr.message })
  }

  // Step 16: insert post_references for resolved wikilinks
  if (resolvedAnchors.length > 0) {
    const { error: refsErr } = await admin.from('post_references').insert(
      resolvedAnchors.map(({ targetPostId, targetSlug }) => ({
        source_post_id: postId,
        target_post_id: targetPostId,
        target_slug: targetSlug,
      })),
    )
    if (refsErr) {
      return json(500, { error: 'post_references_insert_failed', detail: refsErr.message })
    }
  }

  // Step 17: return 201 with { id, slug, url }
  return json(201, {
    id: postId,
    slug: finalSlug,
    url: postUrl(username, type as PostType, finalSlug),
  })
}

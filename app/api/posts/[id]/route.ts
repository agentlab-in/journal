import type { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { getSession, resolveIsAdmin } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { PostPatchBody } from '@/lib/posts/schema'
import { isValidCoverImageUrl } from '@/lib/posts/cover-image'
import { extractStructuredSections } from '@/lib/posts/sections'
import { extractWikilinkAnchors } from '@/lib/posts/wikilinks-extract'
import { resolveAnchor } from '@/lib/posts/wikilinks-resolve'
import { renderToHtml } from '@/lib/posts/render'
import { isReserved } from '@/lib/reserved-names'
import { postUrl, type PostType } from '@/lib/posts/url'
import { guardMutatingRequest } from '@/lib/route-guard'
import { getActiveOrgById } from '@/lib/orgs/auth'
import { logRouteError } from '@/lib/logging/error-log'

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

interface PostRow {
  id: string
  author_id: string
  org_id: string | null
  slug: string
  type: string
  body_md: string
  deleted_at: string | null
}

// ---------------------------------------------------------------------------
// PATCH /api/posts/[id]
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest | Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Step 1: auth
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  // Step 1b: origin + rate-limit guard (Phase 14)
  const guard = await guardMutatingRequest(req, { bucket: 'edit_post', userId })
  if (guard.failed) return guard.response

  const { id: postId } = await context.params

  const admin = createAdminSupabaseClient()

  // Step 2: load post by id
  const { data: postRow, error: postFetchErr } = await admin
    .from('posts')
    .select('id, author_id, org_id, slug, type, body_md, deleted_at')
    .eq('id', postId)
    .single()

  if (postFetchErr || !postRow) {
    return json(404, { error: 'not_found' })
  }
  const post = postRow as PostRow

  // Already-deleted → treat as 404
  if (post.deleted_at !== null) {
    return json(404, { error: 'not_found' })
  }

  // Step 3: author OR admin check
  const isAuthor = userId === post.author_id
  const isAdminUser = await resolveIsAdmin(userId)

  if (!isAuthor && !isAdminUser) {
    return json(403, { error: 'forbidden' })
  }

  // Step 4: JSON parse
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  // Step 5: Zod parse — PostPatchBody (no type field)
  const parsed = PostPatchBody.safeParse(raw)
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_body',
      issues: parsed.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    })
  }

  const { title, summary, body_md, tags, cover_image_url, org_id: bodyOrgId } = parsed.data

  // Step 5b: org_id is immutable post-publish — mirror slug_immutable semantics.
  // Accept the field in the body so existing clients editing don't 400, but
  // reject if the value differs from what's stored.
  if (bodyOrgId !== undefined && bodyOrgId !== post.org_id) {
    return json(400, { error: 'org_id_immutable' })
  }

  // Step 6: cover_image_url bucket check
  if (cover_image_url !== undefined && !isValidCoverImageUrl(cover_image_url)) {
    return json(400, { error: 'invalid_cover_url' })
  }

  // Step 7: re-derive structured_sections from new body_md using post's existing type
  const postType = post.type as PostType
  const structured_sections = extractStructuredSections(body_md, postType)
  if (postType !== 'post' && structured_sections !== null) {
    const required = REQUIRED_SECTION_KEYS[postType] ?? []
    const missing = required.filter(
      (k) => !structured_sections[k] || !String(structured_sections[k]).trim(),
    )
    if (missing.length > 0) {
      return json(400, { error: 'missing_sections', detail: missing.join(', ') })
    }
  }

  // Step 8: tag handling — pre-fetch existing tags, reserved check, insert pending
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

  // Insert new pending tags
  //
  // public.tags.name is NOT NULL with no default (see 0002_content.sql), so
  // we must derive a display name from the slug. Approving moderators can
  // rewrite this in the admin UI; this is just the pending-state placeholder.
  if (newTagSlugs.length > 0) {
    const { error: tagInsertErr } = await admin.from('tags').insert(
      newTagSlugs.map((slug) => ({
        slug,
        name: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        is_approved: false,
        approved_by: null,
        approved_at: null,
      })),
    )
    if (tagInsertErr) {
      return json(500, { error: 'tag_insert_failed', detail: tagInsertErr.message })
    }
  }

  // Step 9: compute next version_no — MAX from post_versions for this post
  const { data: versionRows, error: versionFetchErr } = await admin
    .from('post_versions')
    .select('version_no')
    .eq('post_id', postId)

  if (versionFetchErr) {
    return json(500, { error: 'version_fetch_failed', detail: versionFetchErr.message })
  }

  const maxVersionNo = ((versionRows ?? []) as Array<{ version_no: number }>).reduce(
    (max, r) => Math.max(max, r.version_no),
    0,
  )
  const nextVersionNo = maxVersionNo + 1

  // Snapshot the PRIOR body_md (NOT the new one) before updating
  const { error: versionInsertErr } = await admin.from('post_versions').insert([
    { post_id: postId, version_no: nextVersionNo, body_md: post.body_md },
  ])
  if (versionInsertErr) {
    return json(500, { error: 'version_insert_failed', detail: versionInsertErr.message })
  }

  // Step 10: wikilink anchors → resolve each
  const anchors = extractWikilinkAnchors(body_md)
  const resolvedMap = new Map<string, string>()
  const resolvedAnchors: Array<{ targetPostId: string; targetSlug: string }> = []

  for (const anchor of anchors) {
    const resolved = await resolveAnchor(anchor, { db: admin, currentUserId: userId })
    if (resolved) {
      const url = postUrl(resolved.targetLeadingSegment, resolved.targetType, resolved.targetSlug)
      resolvedMap.set(anchor, url)
      resolvedAnchors.push({
        targetPostId: resolved.targetPostId,
        targetSlug: resolved.targetSlug,
      })
    }
  }

  // Step 11: render body_html with resolver map
  const body_html = await renderToHtml(body_md, {
    resolveAnchor: (a) => resolvedMap.get(a) ?? null,
  })

  // Step 12: replace post_references — delete then insert
  const { error: refsDeleteErr } = await admin
    .from('post_references')
    .delete()
    .eq('source_post_id', postId)

  if (refsDeleteErr) {
    return json(500, { error: 'refs_delete_failed', detail: refsDeleteErr.message })
  }

  if (resolvedAnchors.length > 0) {
    const { error: refsInsertErr } = await admin.from('post_references').insert(
      resolvedAnchors.map(({ targetPostId, targetSlug }) => ({
        source_post_id: postId,
        target_post_id: targetPostId,
        target_slug: targetSlug,
      })),
    )
    if (refsInsertErr) {
      return json(500, { error: 'refs_insert_failed', detail: refsInsertErr.message })
    }
  }

  // Step 13: replace post_tags — delete then insert
  const { error: tagsDeleteErr } = await admin
    .from('post_tags')
    .delete()
    .eq('post_id', postId)

  if (tagsDeleteErr) {
    return json(500, { error: 'tags_delete_failed', detail: tagsDeleteErr.message })
  }

  const { error: tagsInsertErr } = await admin.from('post_tags').insert(
    tags.map((tag_slug) => ({ post_id: postId, tag_slug })),
  )
  if (tagsInsertErr) {
    return json(500, { error: 'tags_insert_failed', detail: tagsInsertErr.message })
  }

  // Step 14: update posts row
  // Resolve the URL leading segment: org slug when posted under an org, else
  // the author's username (matches T4 routing and POST behavior).
  let leadingSegment = ''
  if (post.org_id) {
    const org = await getActiveOrgById(admin, post.org_id)
    leadingSegment = org?.slug ?? ''
  } else {
    const { data: authorRow } = await admin
      .from('users')
      .select('username')
      .eq('id', post.author_id)
      .single()
    leadingSegment = (authorRow as { username: string } | null)?.username ?? ''
  }

  const { error: updateErr } = await admin
    .from('posts')
    .update({
      title,
      summary,
      body_md,
      body_html,
      structured_sections: structured_sections ?? null,
      cover_image_url: cover_image_url ?? null,
      edited_at: new Date().toISOString(),
    })
    .eq('id', postId)

  if (updateErr) {
    return json(500, { error: 'update_failed', detail: updateErr.message })
  }

  // Step 15: Invalidate the discovery cache so the very next request
  // re-queries. Called after the final DB write succeeds.
  // If the PATCH created new tags, invalidate 'tags' too.
  // Contract: discovery-cache.ts registers tags: ['posts', 'tags'].
  revalidateTag('posts', { expire: 0 })
  if (newTagSlugs.length > 0) {
    revalidateTag('tags', { expire: 0 })
  }

  // Step 16: return 200 with { id, slug, url }
  return json(200, {
    id: postId,
    slug: post.slug,
    url: postUrl(leadingSegment, postType, post.slug),
  })
}

// ---------------------------------------------------------------------------
// DELETE /api/posts/[id]
// ---------------------------------------------------------------------------

export async function DELETE(
  req: NextRequest | Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Step 1: auth
  const session = await getSession()
  if (!session?.user?.id) return json(401, { error: 'unauthorized' })
  const userId = session.user.id

  // Step 1b: origin + rate-limit guard (Phase 14)
  const guard = await guardMutatingRequest(req, { bucket: 'delete_post', userId })
  if (guard.failed) return guard.response

  const { id: postId } = await context.params

  const admin = createAdminSupabaseClient()

  // Step 2: load post
  const { data: postRow, error: postFetchErr } = await admin
    .from('posts')
    .select('id, author_id, slug, deleted_at')
    .eq('id', postId)
    .single()

  if (postFetchErr || !postRow) {
    return json(404, { error: 'not_found' })
  }
  const post = postRow as { id: string; author_id: string; slug: string; deleted_at: string | null }

  // Already-deleted → 404
  if (post.deleted_at !== null) {
    return json(404, { error: 'not_found' })
  }

  // Step 3: author/admin gate
  const isAuthor = userId === post.author_id
  const isAdminUser = await resolveIsAdmin(userId)

  if (!isAuthor && !isAdminUser) {
    return json(403, { error: 'forbidden' })
  }

  // Step 4: parse optional reason from body (defensive — empty/invalid body is fine)
  let reason: string | null = null
  try {
    const raw = await req.text()
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && typeof parsed.reason === 'string') {
        reason = parsed.reason.slice(0, 1000)
      }
    }
  } catch {
    // ignore — author self-delete commonly has no body
  }

  // Step 5: determine deletion_reason
  // If author triggered delete → 'author' (takes precedence even if also admin)
  // If admin (not author) → 'moderation'
  const deletion_reason: 'author' | 'moderation' = isAuthor ? 'author' : 'moderation'

  // Update posts SET deleted_at + deletion_reason (do NOT touch post_tags, post_references, etc.)
  const { error: updateErr } = await admin
    .from('posts')
    .update({
      deleted_at: new Date().toISOString(),
      deletion_reason,
    })
    .eq('id', postId)

  if (updateErr) {
    return json(500, { error: 'delete_failed', detail: updateErr.message })
  }

  // Invalidate the discovery cache so the very next request re-queries.
  // Called after the soft-delete UPDATE succeeds.
  // Contract: discovery-cache.ts registers tags: ['posts', 'tags'].
  revalidateTag('posts', { expire: 0 })

  // Step 6: if moderation delete, write a mod_actions audit row
  if (deletion_reason === 'moderation') {
    const { error: modErr } = await admin.from('mod_actions').insert({
      mod_user_id: userId,
      action: 'delete_post',
      target_type: 'post',
      target_id: String(postId),
      reason,
      metadata: { slug: post.slug, author_id: post.author_id },
    })
    if (modErr) {
      logRouteError(modErr, {
        route: '/api/posts/[id]',
        userId,
        extra: { op: 'mod_actions_insert', postId },
      })
      // soft failure — deletion already succeeded, do not roll back
    }
  }

  // Step 7: return { ok: true }
  return json(200, { ok: true })
}

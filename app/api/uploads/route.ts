/**
 * POST /api/uploads
 *
 * Auth-required image upload. Accepts a multipart form with a single `file`
 * field. The pipeline is:
 *
 *   1. Reject if no session.
 *   2. Validate `?bucket` query param (default `covers`).
 *   3. Read at most 2MB + 1 byte from the multipart blob; reject if exceeded.
 *   4. Sniff magic bytes (NOT the multipart Content-Type header).
 *   5. Read sharp metadata; reject if width/height > 6000.
 *   6. Run sharp pipeline (rotate → resize 1600 → webp 85, strips EXIF).
 *   7. Upload to the configured Supabase Storage bucket via service role.
 *   8. Return public URL + output dimensions.
 *
 * Error contract (see Phase-3 task 12):
 *   401 unauthorized            — no session
 *   400 no_file                 — missing/empty file field
 *   400 invalid_bucket          — unsupported ?bucket value
 *   413 file_too_large          — > 2MB
 *   415 unsupported_type        — magic-byte sniff failed
 *   413 dimensions_too_large    — width or height > 6000
 *   500 upload_failed           — Supabase storage error
 */
import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { sniffMime, validateBucket } from '@/lib/uploads/validate'
import { processImage, readDimensions } from '@/lib/uploads/process'
import { randomUUID } from 'node:crypto'
import { guardMutatingRequest } from '@/lib/route-guard'

// Route Handlers run on the Node.js runtime by default (we need it for
// sharp + node:crypto). Make this explicit so a future change to the
// project-wide default doesn't silently break the route.
export const runtime = 'nodejs'

const MAX_BYTES = 2 * 1024 * 1024 // 2MB
const MAX_DIMENSION = 6000

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function POST(req: NextRequest): Promise<Response> {
  // 1. Auth
  //
  // C7: this getSession() call is the ONLY enforcement layer for uploads.
  // Content tables (posts, comments, etc.) get a second net from the
  // 0024_approved_users.sql BEFORE INSERT triggers, but storage.objects has
  // no such trigger behind it, so there is nothing downstream to catch a
  // write here if getSession() is ever refactored to stop checking approval.
  // A future editor touching getSession()'s ban/approval gate must know
  // uploads has no second net.
  const session = await getSession()
  if (!session?.user?.id) {
    return json(401, { error: 'unauthorized' })
  }
  const userId = session.user.id

  // 1b. Origin + image_upload bucket rate-limit (Phase 14)
  const guard = await guardMutatingRequest(req, { bucket: 'image_upload', userId, requireConsent: true })
  if (guard.failed) return guard.response

  // 1c. Cheap Content-Length pre-check. `req.formData()` materialises the
  // entire multipart body in memory before the per-file size cap below
  // gets a chance to fire, which is the H11 DoS primitive. Reject early
  // when the advertised body size couldn't possibly fit under MAX_BYTES
  // (plus a 4KB multipart-framing slop). Content-Length can lie — the
  // post-parse `file.size` check still runs.
  //
  // Returns the same `file_too_large` code as the post-parse path: the
  // upload UI (CoverImagePicker, ProfileSettingsForm) keys its error
  // message off that string, so reusing it surfaces a sensible toast
  // instead of "unknown error" when the pre-check fires.
  const contentLengthHeader = req.headers.get('content-length')
  if (contentLengthHeader !== null) {
    const declaredLength = Number(contentLengthHeader)
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_BYTES + 4096
    ) {
      return json(413, { error: 'file_too_large' })
    }
  }

  // 2. Bucket
  const bucketParam = req.nextUrl.searchParams.get('bucket')
  const bucket = validateBucket(bucketParam)
  if (!bucket) {
    return json(400, { error: 'invalid_bucket' })
  }

  // 3. Read multipart
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json(400, { error: 'no_file' })
  }
  const file = form.get('file')
  if (!file || typeof file === 'string') {
    return json(400, { error: 'no_file' })
  }

  // Size cap — read at most MAX_BYTES+1 to detect overflow without
  // allocating arbitrarily large buffers from a hostile client.
  if (typeof file.size === 'number' && file.size > MAX_BYTES) {
    return json(413, { error: 'file_too_large' })
  }
  const arrayBuf = await file.arrayBuffer()
  if (arrayBuf.byteLength > MAX_BYTES) {
    return json(413, { error: 'file_too_large' })
  }
  const buffer = Buffer.from(arrayBuf)
  if (buffer.length === 0) {
    return json(400, { error: 'no_file' })
  }

  // 4. Magic-byte sniff
  if (sniffMime(buffer) === null) {
    return json(415, { error: 'unsupported_type' })
  }

  // 5. Dimensions cap (sharp metadata, pre-resize)
  let inputDims: { width: number; height: number }
  try {
    inputDims = await readDimensions(buffer)
  } catch {
    return json(415, { error: 'unsupported_type' })
  }
  if (inputDims.width > MAX_DIMENSION || inputDims.height > MAX_DIMENSION) {
    return json(413, { error: 'dimensions_too_large' })
  }

  // 6. Process via sharp
  let processed
  try {
    processed = await processImage(buffer)
  } catch {
    return json(415, { error: 'unsupported_type' })
  }

  // 7. Upload to Supabase Storage (service role bypasses RLS)
  const key = `${userId}/${randomUUID()}.webp`
  const supabase = createAdminSupabaseClient()
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(key, processed.webp, {
      contentType: 'image/webp',
      upsert: false,
    })
  if (uploadError) {
    return json(500, { error: 'upload_failed', detail: uploadError.message })
  }

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(key)

  return json(200, {
    url: pub.publicUrl,
    width: processed.width,
    height: processed.height,
  })
}

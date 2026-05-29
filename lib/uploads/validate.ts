/**
 * Upload validation helpers — pure functions, no I/O.
 *
 * The two helpers here are split out so they can be unit-tested without
 * spinning up a Next.js route handler or mocking Supabase. The route at
 * `app/api/uploads/route.ts` calls them in order.
 */

export type SniffedMime = 'jpeg' | 'png' | 'webp' | 'gif'

export type AllowedBucket = 'covers' | 'post-images' | 'avatars'

/**
 * Inspect the first few bytes of a buffer and return the detected image
 * mime type, or null if it doesn't match any of the four supported formats.
 *
 * We sniff bytes rather than trusting the multipart `Content-Type` header
 * because a hostile client can lie about it (e.g. label a PHP shell as
 * `image/png`). Magic byte sequences:
 *
 *   - JPEG: FF D8 FF
 *   - PNG:  89 50 4E 47 0D 0A 1A 0A
 *   - WebP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50  (RIFF...WEBP)
 *   - GIF:  47 49 46 38 (37|39) 61               (GIF87a or GIF89a)
 */
export function sniffMime(buffer: Buffer): SniffedMime | null {
  if (buffer.length < 3) return null

  // JPEG — FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg'
  }

  // PNG — 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png'
  }

  // GIF — 47 49 46 38 (37|39) 61
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return 'gif'
  }

  // WebP — RIFF....WEBP at offsets 0-3 and 8-11
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp'
  }

  return null
}

/**
 * Resolve the `?bucket` query param against the allowlist.
 *
 * - `null` (no param given) → defaults to `'covers'`
 * - `'covers'`, `'post-images'`, or `'avatars'` → returned as-is
 * - anything else (including empty string or different case) → `null` (reject)
 */
export function validateBucket(name: string | null): AllowedBucket | null {
  if (name === null) return 'covers'
  if (name === 'covers') return 'covers'
  if (name === 'post-images') return 'post-images'
  if (name === 'avatars') return 'avatars'
  return null
}

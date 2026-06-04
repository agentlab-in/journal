/**
 * sharp processing pipeline.
 *
 *   .rotate()                            — applies EXIF orientation
 *   .resize({ width: 1600,               — caps width at 1600px
 *             withoutEnlargement: true })  but never upscales a smaller image
 *   .webp({ quality: 85 })               — re-encodes (this also strips EXIF)
 *
 * Returns the encoded WebP buffer plus the *output* dimensions (after the
 * resize pass), so the caller can return them in the response and inline
 * them in <img width height> attributes without re-decoding.
 */
import sharp from 'sharp'

export interface ProcessedImage {
  webp: Buffer
  width: number
  height: number
}

export const MAX_WIDTH = 1600
export const WEBP_QUALITY = 85

/**
 * Cap decode-side pixel count to 36 MP (~6000x6000). Sharp throws if the
 * input exceeds this, which is what we want — a 100 GB pixel bomb in a
 * 50 KB file is the classic image-DoS vector. `failOn: 'error'` makes
 * libvips refuse malformed/truncated inputs rather than producing a
 * best-effort partial decode. `sequentialRead` is a memory-locality hint
 * that avoids buffering the whole image when the output is a stream.
 */
const SHARP_OPTIONS = {
  limitInputPixels: 36_000_000,
  failOn: 'error',
  sequentialRead: true,
} as const

/**
 * Read width/height from sharp's metadata without consuming the buffer.
 * Throws if sharp can't parse the input — caller should map this to a 415.
 */
export async function readDimensions(
  input: Buffer,
): Promise<{ width: number; height: number }> {
  const metadata = await sharp(input, SHARP_OPTIONS).metadata()
  const width = metadata.width
  const height = metadata.height
  if (typeof width !== 'number' || typeof height !== 'number') {
    throw new Error('image has no readable dimensions')
  }
  return { width, height }
}

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const { data, info } = await sharp(input, SHARP_OPTIONS)
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true })

  return {
    webp: data,
    width: info.width,
    height: info.height,
  }
}

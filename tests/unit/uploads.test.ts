import { describe, it, expect, beforeAll } from 'vitest'
import sharp from 'sharp'
import { sniffMime, validateBucket } from '@/lib/uploads/validate'
import { processImage } from '@/lib/uploads/process'

// ---------------------------------------------------------------------------
// sniffMime — magic-byte detection
// ---------------------------------------------------------------------------

describe('sniffMime()', () => {
  it('recognizes JPEG (FF D8 FF)', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    expect(sniffMime(buf)).toBe('jpeg')
  })

  it('recognizes PNG (89 50 4E 47 0D 0A 1A 0A)', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
    expect(sniffMime(buf)).toBe('png')
  })

  it('recognizes WebP (RIFF...WEBP)', () => {
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x24, 0x00, 0x00, 0x00, // file size (any 4 bytes)
      0x57, 0x45, 0x42, 0x50, // WEBP
    ])
    expect(sniffMime(buf)).toBe('webp')
  })

  it('recognizes GIF87a', () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x00])
    expect(sniffMime(buf)).toBe('gif')
  })

  it('recognizes GIF89a', () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00])
    expect(sniffMime(buf)).toBe('gif')
  })

  it('returns null for plain text', () => {
    const buf = Buffer.from('hello world this is plain text content')
    expect(sniffMime(buf)).toBeNull()
  })

  it('returns null for an empty buffer', () => {
    expect(sniffMime(Buffer.alloc(0))).toBeNull()
  })

  it('returns null for RIFF that is not WEBP', () => {
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46,
      0x24, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45, // WAVE — wav file
    ])
    expect(sniffMime(buf)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// validateBucket — default + allowlist
// ---------------------------------------------------------------------------

describe('validateBucket()', () => {
  it('defaults to covers when name is null', () => {
    expect(validateBucket(null)).toBe('covers')
  })

  it("accepts 'covers'", () => {
    expect(validateBucket('covers')).toBe('covers')
  })

  it("accepts 'post-images'", () => {
    expect(validateBucket('post-images')).toBe('post-images')
  })

  it("accepts 'avatars'", () => {
    expect(validateBucket('avatars')).toBe('avatars')
  })

  it('rejects any other name', () => {
    expect(validateBucket('foo')).toBeNull()
    expect(validateBucket('')).toBeNull()
    expect(validateBucket('Covers')).toBeNull() // case-sensitive
    expect(validateBucket('Avatars')).toBeNull() // case-sensitive
  })
})

// ---------------------------------------------------------------------------
// processImage — sharp pipeline
// ---------------------------------------------------------------------------

describe('processImage()', () => {
  let smallPng: Buffer
  let widePng: Buffer
  let smallJpeg: Buffer
  let narrowPng: Buffer

  beforeAll(async () => {
    // 800x600 PNG
    smallPng = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer()

    // 2000x1000 PNG — should be resized to 1600 wide
    widePng = await sharp({
      create: {
        width: 2000,
        height: 1000,
        channels: 3,
        background: { r: 0, g: 255, b: 0 },
      },
    })
      .png()
      .toBuffer()

    // 1024x768 JPEG
    smallJpeg = await sharp({
      create: {
        width: 1024,
        height: 768,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    })
      .jpeg()
      .toBuffer()

    // 400x300 PNG — should NOT be enlarged
    narrowPng = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 128, g: 128, b: 128 },
      },
    })
      .png()
      .toBuffer()
  })

  it('processes a valid PNG to WebP and returns dimensions', async () => {
    const result = await processImage(smallPng)
    expect(result.width).toBe(800)
    expect(result.height).toBe(600)
    expect(result.webp.length).toBeGreaterThan(0)
    // Verify it is actually a WebP buffer via magic bytes
    expect(result.webp.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(result.webp.subarray(8, 12).toString('ascii')).toBe('WEBP')
  })

  it('processes a valid JPEG to WebP', async () => {
    const result = await processImage(smallJpeg)
    expect(result.width).toBe(1024)
    expect(result.height).toBe(768)
    expect(result.webp.subarray(8, 12).toString('ascii')).toBe('WEBP')
  })

  it('resizes a 2000-wide image down to 1600 wide', async () => {
    const result = await processImage(widePng)
    expect(result.width).toBe(1600)
    // Aspect ratio preserved (2000:1000 = 2:1 → 1600:800)
    expect(result.height).toBe(800)
  })

  it('does NOT enlarge a 400-wide image', async () => {
    const result = await processImage(narrowPng)
    expect(result.width).toBe(400)
    expect(result.height).toBe(300)
  })

  it('throws on input sharp cannot parse', async () => {
    const garbage = Buffer.from('this is not an image, just random text bytes')
    await expect(processImage(garbage)).rejects.toThrow()
  })
})

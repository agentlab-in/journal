#!/usr/bin/env node
/**
 * Generate prefers-color-scheme icon variants from public/logo.svg.
 *
 * Output:
 *   - public/icon-light.png  (dark mark on white circle) — for light UI chrome
 *   - public/icon-dark.png   (white mark on near-black circle) — for dark UI chrome
 *
 * Both are 256x256, PNG. The logo glyph is composited onto a circular
 * disc; the corners outside the circle are transparent so the browser
 * tab chrome shows through cleanly. Wired into <link rel="icon" media="…">
 * in app/layout.tsx so browsers that honor prefers-color-scheme media
 * queries pick the right contrast for the user's OS / browser theme.
 *
 * Why a script instead of `app/icon.tsx` (programmatic):
 * - `app/icon.tsx` only supports a single icon route at a time and
 *   doesn't let us emit two PNGs with different `media` annotations
 *   in one shot. The image-file convention does, and the rendered
 *   PNGs cache cleanly at the CDN.
 *
 * Run with:  node scripts/generate-icons.mjs
 * (Re-run only when the logo or color palette changes; outputs are
 * committed to /public so production never runs this script.)
 *
 * Implementation note: public/logo.svg uses `fill="currentColor"`,
 * which sharp's rasterizer interprets as black on a transparent bg.
 * We inject an explicit fill color into a clone of the SVG before
 * rasterizing each variant so the contrast lands where we want it.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SOURCE = resolve(ROOT, 'public/logo.svg')
const SIZE = 256

const SOURCE_SVG = await readFile(SOURCE, 'utf8')

function svgWithFill(color) {
  // Replace the literal `currentColor` with a real hex so sharp's
  // librsvg renderer paints the glyph in our chosen color instead of
  // its black fallback. Cheaper than constructing a parser — the
  // source SVG is hand-authored and `currentColor` appears once.
  return SOURCE_SVG.replace('fill="currentColor"', `fill="${color}"`)
}

// Circular alpha mask: white inside the circle, transparent outside.
// Sharp's `dest-in` composite keeps the destination pixels where the
// mask alpha is non-zero, giving us a clean transparent corner cutout
// without anti-aliasing artifacts at the edge.
const CIRCLE_MASK = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">` +
    `<circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2}" fill="white"/>` +
    `</svg>`,
)

async function render(svg, bgHex, outPath) {
  // Render the logo with chosen fill onto a solid bg square first, then
  // mask through the circle. Done in two passes because sharp can't
  // composite a fill background and an alpha mask in one chain — the
  // mask has to apply to a fully-painted buffer.
  const square = await sharp(Buffer.from(svg))
    .resize(SIZE, SIZE, { fit: 'contain', background: bgHex })
    .flatten({ background: bgHex })
    .png()
    .toBuffer()

  await sharp(square)
    .ensureAlpha()
    .composite([{ input: CIRCLE_MASK, blend: 'dest-in' }])
    .png()
    .toFile(outPath)
  console.log(`wrote ${outPath}`)
}

await render(
  svgWithFill('#000000'),
  '#ffffff',
  resolve(ROOT, 'public/icon-light.png'),
)

await render(
  svgWithFill('#ffffff'),
  '#0a0a0a',
  resolve(ROOT, 'public/icon-dark.png'),
)

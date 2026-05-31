/**
 * WCAG AA contrast assertion for theme tokens.
 *
 * Reads app/globals.css and extracts the CSS custom properties for
 * [data-theme='light'], [data-theme='dark'], and the
 * @media (prefers-color-scheme: dark) block (which must stay in lockstep
 * with [data-theme='dark']).
 *
 * Asserts that the four fg/bg pairings each reach ≥4.5:1 (WCAG AA body text).
 *
 * No external deps — the WCAG relative luminance formula is inlined per spec:
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// WCAG math helpers
// ---------------------------------------------------------------------------

function hexToChannels(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  if (h.length !== 6) throw new Error(`Expected 6-digit hex, got: ${hex}`)
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function linearize(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToChannels(hex)
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

function contrastRatio(hexA: string, hexB: string): number {
  const L1 = relativeLuminance(hexA)
  const L2 = relativeLuminance(hexB)
  const lighter = Math.max(L1, L2)
  const darker = Math.min(L1, L2)
  return (lighter + 0.05) / (darker + 0.05)
}

// ---------------------------------------------------------------------------
// CSS parser — extracts token values from named blocks
// ---------------------------------------------------------------------------

/**
 * Extracts `--name: value` pairs from the first occurrence of a block whose
 * opening selector matches `selectorPattern`. Stops at the matching `}`.
 */
function extractTokensFromBlock(css: string, selectorPattern: RegExp): Record<string, string> {
  const match = css.match(selectorPattern)
  if (!match || match.index === undefined) {
    throw new Error(`Block not found for pattern: ${selectorPattern}`)
  }

  // Find the opening brace after the matched selector
  const afterSelector = css.slice(match.index + match[0].length)
  const braceOpen = afterSelector.indexOf('{')
  if (braceOpen === -1) throw new Error('Opening brace not found')

  // Extract content up to the matching closing brace
  let depth = 0
  let end = -1
  for (let i = braceOpen; i < afterSelector.length; i++) {
    if (afterSelector[i] === '{') depth++
    else if (afterSelector[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) throw new Error('Closing brace not found')

  const block = afterSelector.slice(braceOpen + 1, end)
  const tokens: Record<string, string> = {}
  const propRegex = /--([\w-]+)\s*:\s*([^;]+);/g
  let m: RegExpExecArray | null
  while ((m = propRegex.exec(block)) !== null) {
    tokens[`--${m[1]}`] = m[2].trim()
  }
  return tokens
}

// ---------------------------------------------------------------------------
// Load CSS once
// ---------------------------------------------------------------------------

const CSS_PATH = resolve(__dirname, '../../../app/globals.css')
const css = readFileSync(CSS_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Extract token sets
// ---------------------------------------------------------------------------

// Use line-start anchors so we match the block-level selectors and not
// occurrences inside @custom-variant or other rules.
const lightTokens = extractTokensFromBlock(css, /^\[data-theme='light'\]/m)
const darkTokens = extractTokensFromBlock(css, /^\[data-theme='dark'\]/m)
// The media block wraps :root:not([data-theme]) — we match on the media rule
const mediaBlock = (() => {
  // Grab the content of @media (prefers-color-scheme: dark) { … }
  const mediaStart = css.indexOf('@media (prefers-color-scheme: dark)')
  if (mediaStart === -1) throw new Error('@media (prefers-color-scheme: dark) block not found')
  // The inner :root:not([data-theme]) block lives inside — re-slice from there
  const inner = css.slice(mediaStart)
  return extractTokensFromBlock(inner, /:root:not\(\[data-theme\]\)/)
})()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WCAG_AA = 4.5

function assertContrast(label: string, fg: string, bg: string) {
  const ratio = contrastRatio(fg, bg)
  expect(ratio, `${label}: ${fg} on ${bg} → ratio ${ratio.toFixed(2)} < ${WCAG_AA}`).toBeGreaterThanOrEqual(WCAG_AA)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Theme token contrast — WCAG AA (≥4.5:1)', () => {
  describe('light theme [data-theme="light"]', () => {
    const { '--fg': fg, '--bg': bg, '--fg-subtle': fgSubtle, '--bg-subtle': bgSubtle } = lightTokens

    it('--fg on --bg', () => assertContrast('light --fg/--bg', fg, bg))
    it('--fg on --bg-subtle', () => assertContrast('light --fg/--bg-subtle', fg, bgSubtle))
    it('--fg-subtle on --bg', () => assertContrast('light --fg-subtle/--bg', fgSubtle, bg))
    it('--fg-subtle on --bg-subtle', () => assertContrast('light --fg-subtle/--bg-subtle', fgSubtle, bgSubtle))
  })

  describe('dark theme [data-theme="dark"]', () => {
    const { '--fg': fg, '--bg': bg, '--fg-subtle': fgSubtle, '--bg-subtle': bgSubtle } = darkTokens

    it('--fg on --bg', () => assertContrast('dark --fg/--bg', fg, bg))
    it('--fg on --bg-subtle', () => assertContrast('dark --fg/--bg-subtle', fg, bgSubtle))
    it('--fg-subtle on --bg', () => assertContrast('dark --fg-subtle/--bg', fgSubtle, bg))
    it('--fg-subtle on --bg-subtle', () => assertContrast('dark --fg-subtle/--bg-subtle', fgSubtle, bgSubtle))
  })

  describe('dark theme @media prefers-color-scheme:dark (must match [data-theme="dark"])', () => {
    const { '--fg': fg, '--bg': bg, '--fg-subtle': fgSubtle, '--bg-subtle': bgSubtle } = mediaBlock

    it('--fg on --bg', () => assertContrast('media-dark --fg/--bg', fg, bg))
    it('--fg on --bg-subtle', () => assertContrast('media-dark --fg/--bg-subtle', fg, bgSubtle))
    it('--fg-subtle on --bg', () => assertContrast('media-dark --fg-subtle/--bg', fgSubtle, bg))
    it('--fg-subtle on --bg-subtle', () => assertContrast('media-dark --fg-subtle/--bg-subtle', fgSubtle, bgSubtle))

    it('tokens are identical to [data-theme="dark"]', () => {
      const keys: Array<'--fg' | '--bg' | '--fg-subtle' | '--bg-subtle' | '--border' | '--bg-hover'> = [
        '--fg', '--bg', '--fg-subtle', '--bg-subtle', '--border', '--bg-hover',
      ]
      for (const k of keys) {
        expect(
          mediaBlock[k],
          `@media block token ${k} must match [data-theme='dark']`
        ).toBe(darkTokens[k])
      }
    })
  })
})

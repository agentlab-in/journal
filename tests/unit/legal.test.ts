import { describe, it, expect } from 'vitest'
import { LEGAL_DOCS, getLegalDoc } from '@/lib/legal/docs'
import { renderLegalDoc } from '@/lib/legal/render'

describe('legal docs registry', () => {
  it('exposes exactly the single terms route', () => {
    const slugs = LEGAL_DOCS.map((d) => d.slug).sort()
    expect(slugs).toEqual(['terms'])
  })

  it('getLegalDoc returns the matching entry', () => {
    expect(getLegalDoc('terms').file).toBe('terms-of-service.md')
    expect(getLegalDoc('terms').title).toBe('Terms and Privacy')
  })

  it('each registry entry has a non-trivial title and description', () => {
    for (const doc of LEGAL_DOCS) {
      expect(doc.title.length).toBeGreaterThan(2)
      expect(doc.description.length).toBeGreaterThan(20)
    }
  })
})

describe('renderLegalDoc()', () => {
  for (const doc of LEGAL_DOCS) {
    it(`renders ${doc.slug} to HTML with a parseable effective date`, async () => {
      const result = await renderLegalDoc(doc.slug)

      // Body HTML is non-empty and reasonable length.
      expect(result.bodyHtml.length).toBeGreaterThan(500)

      // The leading <h1> is stripped — the page renders its own from
      // the registry title. Anything else may still appear.
      expect(result.bodyHtml.trimStart().startsWith('<h1')).toBe(false)

      // At least one section heading survived the parse.
      expect(result.bodyHtml).toMatch(/<h2[^>]*>/)

      // Effective date is ISO 8601 YYYY-MM-DD.
      expect(result.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(result.effectiveDateLabel.length).toBeGreaterThan(5)
    })
  }

  it('throws on unknown slug', async () => {
    await expect(
      // @ts-expect-error — exercising the runtime guard
      renderLegalDoc('nonexistent'),
    ).rejects.toThrow(/Unknown legal doc/)
  })

  it('does not emit content-policy or copyright cross-link slugs', async () => {
    // After the legal collapse, no doc should reference the retired
    // per-doc paths. Catches accidental re-introduction.
    for (const doc of LEGAL_DOCS) {
      const result = await renderLegalDoc(doc.slug)
      expect(result.bodyHtml).not.toMatch(/href="\/content-policy"/)
      expect(result.bodyHtml).not.toMatch(/href="\/copyright"/)
    }
  })
})

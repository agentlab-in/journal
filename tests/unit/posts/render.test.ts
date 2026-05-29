// tests/unit/posts/render.test.ts
import { describe, it, expect } from 'vitest'
import { renderToHtml } from '@/lib/posts/render'

describe('renderToHtml', () => {
  it('emits sanitized HTML for plain markdown', async () => {
    const html = await renderToHtml('# Hello\n\nWorld', { resolveAnchor: () => null })
    expect(html).toContain('<h1>')
    expect(html).toContain('Hello')
    expect(html).toContain('World')
  })
  it('strips a <script> tag', async () => {
    // In CommonMark, <script>...</script>safe on one line is one HTML block; safe
    // must be in a separate paragraph to survive sanitization. The pipeline
    // correctly drops the HTML block (script) and keeps the paragraph.
    const html = await renderToHtml('<script>alert(1)</script>\n\nsafe', { resolveAnchor: () => null })
    expect(html).not.toContain('<script')
    expect(html).toContain('safe')
  })
  it('rewrites resolved wikilinks to canonical URL', async () => {
    const html = await renderToHtml('see [[Agent Memory]]', {
      resolveAnchor: (anchor) =>
        anchor === 'Agent Memory' ? '/alice/playbook/agent-memory' : null,
    })
    expect(html).toContain('href="/alice/playbook/agent-memory"')
  })
  it('keeps unresolved wikilinks as broken-link span (no anchor)', async () => {
    const html = await renderToHtml('see [[Nobody Knows]]', { resolveAnchor: () => null })
    expect(html).not.toContain('href="/wikilink-resolve')
    expect(html).toContain('broken-wikilink')
    expect(html).toContain('Nobody Knows')
  })
})

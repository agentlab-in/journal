import { describe, it, expect } from 'vitest'
import { hasMermaid } from '@/lib/posts/has-mermaid'

describe('hasMermaid', () => {
  it('returns false for empty input', () => {
    expect(hasMermaid('')).toBe(false)
  })

  it('returns false for plain HTML with no code blocks', () => {
    expect(hasMermaid('<p>Hello world</p>')).toBe(false)
  })

  it('returns false for a non-mermaid fenced code block', () => {
    expect(
      hasMermaid('<pre><code class="language-ts">const x = 1</code></pre>'),
    ).toBe(false)
  })

  it('returns true for a bare `class="language-mermaid"`', () => {
    expect(
      hasMermaid(
        '<pre><code class="language-mermaid">graph TD;A--&gt;B</code></pre>',
      ),
    ).toBe(true)
  })

  it('returns true when language-mermaid is mixed with prism tokens (rehype-prism-plus output)', () => {
    // rehype-prism-plus emits multiple classes on the <code>, e.g.
    // `code-highlight language-mermaid`.
    expect(
      hasMermaid(
        '<pre class="language-mermaid"><code class="code-highlight language-mermaid">graph TD</code></pre>',
      ),
    ).toBe(true)
  })

  it('returns true regardless of attribute order on the <code>', () => {
    expect(
      hasMermaid(
        '<pre><code data-foo="bar" class="language-mermaid token">graph</code></pre>',
      ),
    ).toBe(true)
  })

  it('does not match a partial class token like `language-mermaidish`', () => {
    expect(
      hasMermaid(
        '<pre><code class="language-mermaidish">not mermaid</code></pre>',
      ),
    ).toBe(false)
  })

  it('does not match when "language-mermaid" appears only in text content', () => {
    expect(
      hasMermaid('<p>The string language-mermaid is mentioned here.</p>'),
    ).toBe(false)
  })

  it('matches a code block buried in a larger document', () => {
    const html =
      '<h1>Title</h1>' +
      '<p>Intro</p>' +
      '<pre><code class="language-ts">noop()</code></pre>' +
      '<p>Diagram:</p>' +
      '<pre><code class="code-highlight language-mermaid">graph TD;A--&gt;B</code></pre>' +
      '<p>End.</p>'
    expect(hasMermaid(html)).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { compileMdx } from '@/lib/mdx/compile'

/**
 * These tests exercise the sanitize schema through the real compile
 * pipeline (`compileMdx`), since the schema only makes sense in concert
 * with the MDX-JSX → HAST-element conversion that the pipeline applies
 * before `rehype-sanitize` runs. We assert against the compiled source
 * string returned by `next-mdx-remote/serialize`, which inlines all
 * surviving tag names, attributes, and class names as JSX-flavoured JS.
 */

describe('mdx sanitize schema', () => {
  it('strips raw <script> tags but keeps the surrounding heading', async () => {
    const out = await compileMdx('## h2\n\n<script>alert(1)</script>')
    expect(out.compiledSource).toContain('h2')
    expect(out.compiledSource).not.toContain('script')
    expect(out.compiledSource).not.toContain('alert(1)')
  })

  it('strips inline event handler attributes like onClick / onclick', async () => {
    const out = await compileMdx('<p onclick="bad()">x</p>')
    // The element survives, but no onclick / onClick lands in the JSX.
    expect(out.compiledSource).toContain('"p"')
    expect(out.compiledSource.toLowerCase()).not.toContain('onclick')
    expect(out.compiledSource).not.toContain('bad()')
  })

  it('strips inline style attribute even on allowed tags', async () => {
    const out = await compileMdx('<p style="color:red">x</p>')
    expect(out.compiledSource).toContain('"p"')
    expect(out.compiledSource).not.toContain('color:red')
    expect(out.compiledSource).not.toContain('"style"')
  })

  it('strips raw <iframe> tags', async () => {
    const out = await compileMdx('<iframe src="https://evil.test"></iframe>')
    expect(out.compiledSource).not.toContain('iframe')
    expect(out.compiledSource).not.toContain('evil.test')
  })

  it('preserves a <Callout type="info"> as a lowercase callout element', async () => {
    const out = await compileMdx('<Callout type="info">hi</Callout>')
    // Lowercased tag name — components.ts maps it to the React Callout.
    expect(out.compiledSource).toContain('"callout"')
    // The MDX compiler emits unquoted property keys: `type: "info"`.
    expect(out.compiledSource).toMatch(/type:\s*"info"/)
    expect(out.compiledSource).toContain('hi')
  })

  it('drops <Callout type="evil"> (attribute value not in allowlist)', async () => {
    const out = await compileMdx('<Callout type="evil">bad</Callout>')
    expect(out.compiledSource).toContain('"callout"')
    // Restricted attribute values: "evil" is not allowed → attribute dropped,
    // but the element itself survives.
    expect(out.compiledSource).not.toMatch(/type:\s*"evil"/)
    expect(out.compiledSource).not.toContain('"evil"')
  })

  it('preserves <Figure src=... alt=... caption=...>', async () => {
    const out = await compileMdx(
      '<Figure src="https://cdn.test/x.png" alt="x" caption="cap" />',
    )
    expect(out.compiledSource).toContain('"figure"')
    expect(out.compiledSource).toContain('cdn.test/x.png')
    expect(out.compiledSource).toMatch(/alt:\s*"x"/)
    expect(out.compiledSource).toMatch(/caption:\s*"cap"/)
  })

  it('preserves <Embed url=... provider=...>', async () => {
    const out = await compileMdx(
      '<Embed url="https://youtu.be/abc" provider="youtube" />',
    )
    expect(out.compiledSource).toContain('"embed"')
    expect(out.compiledSource).toContain('youtu.be/abc')
    expect(out.compiledSource).toMatch(/provider:\s*"youtube"/)
  })

  it('preserves <Aside> children', async () => {
    const out = await compileMdx('<Aside>side note</Aside>')
    expect(out.compiledSource).toContain('"aside"')
    expect(out.compiledSource).toContain('side note')
  })

  it('preserves <Detail summary="x"> children', async () => {
    const out = await compileMdx('<Detail summary="x">y</Detail>')
    expect(out.compiledSource).toContain('"detail"')
    expect(out.compiledSource).toMatch(/summary:\s*"x"/)
    expect(out.compiledSource).toContain('"y"')
  })

  it('preserves <sub> and <sup>', async () => {
    const out = await compileMdx('H<sub>2</sub>O E=mc<sup>2</sup>')
    expect(out.compiledSource).toContain('"sub"')
    expect(out.compiledSource).toContain('"sup"')
  })

  it('preserves a mermaid fenced code block (language-mermaid className survives)', async () => {
    const md = '```mermaid\ngraph TD;\nA-->B\n```'
    const out = await compileMdx(md)
    // The `language-mermaid` className survives sanitize. Prism tokenises
    // the contents, so we look for a fragment of the source that survives
    // tokenisation rather than the literal `graph TD;` string.
    expect(out.compiledSource).toContain('language-mermaid')
    expect(out.compiledSource).toContain('graph')
    expect(out.compiledSource).toContain(' TD')
  })
})

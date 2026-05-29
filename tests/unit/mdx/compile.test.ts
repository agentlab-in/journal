import { describe, it, expect } from 'vitest'
import { compileMdx } from '@/lib/mdx/compile'

describe('compileMdx', () => {
  it('resolves and returns an object with a compiledSource string', async () => {
    const out = await compileMdx('# Hello')
    expect(out).toBeDefined()
    expect(typeof out.compiledSource).toBe('string')
    expect(out.compiledSource.length).toBeGreaterThan(0)
  })

  it('runs the wikilinks remark plugin (link to /wikilink-resolve?title=World)', async () => {
    const out = await compileMdx('# Hello [[World]]')
    expect(out.compiledSource).toContain('/wikilink-resolve?title=World')
  })

  it('runs remark-gfm (GFM tables compile to <table> markup)', async () => {
    const out = await compileMdx('| a | b |\n|---|---|\n| 1 | 2 |\n')
    expect(out.compiledSource).toContain('"table"')
    expect(out.compiledSource).toContain('"tr"')
    expect(out.compiledSource).toContain('"td"')
  })

  it('runs remark-gfm task lists', async () => {
    const out = await compileMdx('- [x] done\n- [ ] todo\n')
    // Task list checkboxes survive as <input type="checkbox" disabled />.
    expect(out.compiledSource).toContain('"input"')
    expect(out.compiledSource).toContain('"checkbox"')
  })

  it('does not throw on empty input', async () => {
    await expect(compileMdx('')).resolves.toBeDefined()
  })

  it('does not throw on plain prose', async () => {
    await expect(compileMdx('just some words')).resolves.toBeDefined()
  })
})

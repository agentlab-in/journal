import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { visit } from 'unist-util-visit'
import type { Root, Link, Text, Paragraph, InlineCode, Code } from 'mdast'
import wikilinks from '@/lib/mdx/wikilinks'

async function parse(input: string): Promise<Root> {
  const processor = unified().use(remarkParse).use(wikilinks)
  const tree = processor.parse(input)
  const transformed = (await processor.run(tree)) as Root
  return transformed
}

function findLinks(tree: Root): Link[] {
  const links: Link[] = []
  visit(tree, 'link', (node) => {
    links.push(node)
  })
  return links
}

function firstParagraph(tree: Root): Paragraph {
  const p = tree.children.find((n) => n.type === 'paragraph') as
    | Paragraph
    | undefined
  if (!p) throw new Error('no paragraph in tree')
  return p
}

describe('wikilinks remark plugin', () => {
  it('converts [[Title]] to a link node with stub URL', async () => {
    const tree = await parse('[[Title]]')
    const links = findLinks(tree)
    expect(links).toHaveLength(1)
    expect(links[0].url).toBe('/wikilink-resolve?title=Title')
    expect(links[0].children).toHaveLength(1)
    const child = links[0].children[0] as Text
    expect(child.type).toBe('text')
    expect(child.value).toBe('Title')
  })

  it('converts [[Title|Display]] to link with title URL and alias text', async () => {
    const tree = await parse('[[Title|Display]]')
    const links = findLinks(tree)
    expect(links).toHaveLength(1)
    expect(links[0].url).toBe('/wikilink-resolve?title=Title')
    const child = links[0].children[0] as Text
    expect(child.value).toBe('Display')
  })

  it('URL-encodes spaces in title', async () => {
    const tree = await parse('[[Spaces in Title]]')
    const links = findLinks(tree)
    expect(links).toHaveLength(1)
    expect(links[0].url).toBe('/wikilink-resolve?title=Spaces%20in%20Title')
    const child = links[0].children[0] as Text
    expect(child.value).toBe('Spaces in Title')
  })

  it('URL-encodes special characters like & in title', async () => {
    const tree = await parse('[[A & B]]')
    const links = findLinks(tree)
    expect(links).toHaveLength(1)
    expect(links[0].url).toBe('/wikilink-resolve?title=A%20%26%20B')
  })

  it('does not transform [[X]] inside inline code', async () => {
    const tree = await parse('`[[X]]`')
    const links = findLinks(tree)
    expect(links).toHaveLength(0)
    const para = firstParagraph(tree)
    const codeNode = para.children.find(
      (n) => n.type === 'inlineCode',
    ) as InlineCode | undefined
    expect(codeNode).toBeDefined()
    expect(codeNode!.value).toBe('[[X]]')
  })

  it('does not transform [[X]] inside a fenced code block', async () => {
    const tree = await parse('```\n[[X]]\n```')
    const links = findLinks(tree)
    expect(links).toHaveLength(0)
    const codeBlock = tree.children.find((n) => n.type === 'code') as
      | Code
      | undefined
    expect(codeBlock).toBeDefined()
    expect(codeBlock!.value).toBe('[[X]]')
  })

  it('handles multiple wikilinks in one paragraph with surrounding text', async () => {
    const tree = await parse('a [[B]] and [[C]]')
    const para = firstParagraph(tree)
    expect(para.children).toHaveLength(4)
    expect(para.children[0].type).toBe('text')
    expect((para.children[0] as Text).value).toBe('a ')
    expect(para.children[1].type).toBe('link')
    expect((para.children[1] as Link).url).toBe('/wikilink-resolve?title=B')
    expect(para.children[2].type).toBe('text')
    expect((para.children[2] as Text).value).toBe(' and ')
    expect(para.children[3].type).toBe('link')
    expect((para.children[3] as Link).url).toBe('/wikilink-resolve?title=C')
  })

  it('preserves leading and trailing text around a single wikilink', async () => {
    const tree = await parse('before [[X]] after')
    const para = firstParagraph(tree)
    expect(para.children).toHaveLength(3)
    expect((para.children[0] as Text).value).toBe('before ')
    expect((para.children[1] as Link).url).toBe('/wikilink-resolve?title=X')
    expect((para.children[2] as Text).value).toBe(' after')
  })

  it('leaves empty [[]] unchanged (no match)', async () => {
    const tree = await parse('[[]]')
    const links = findLinks(tree)
    expect(links).toHaveLength(0)
    // The text node should still carry the literal characters.
    const para = firstParagraph(tree)
    const textValues = para.children
      .filter((c): c is Text => c.type === 'text')
      .map((c) => c.value)
      .join('')
    expect(textValues).toContain('[[]]')
  })

  it('does not match wikilink when title contains a newline', async () => {
    const tree = await parse('[[Foo\nBar]]')
    const links = findLinks(tree)
    expect(links).toHaveLength(0)
  })

  it('handles wikilink at start of text node', async () => {
    const tree = await parse('[[Start]] tail')
    const para = firstParagraph(tree)
    expect(para.children).toHaveLength(2)
    expect((para.children[0] as Link).type).toBe('link')
    expect((para.children[0] as Link).url).toBe('/wikilink-resolve?title=Start')
    expect((para.children[1] as Text).value).toBe(' tail')
  })

  it('handles wikilink at end of text node', async () => {
    const tree = await parse('lead [[End]]')
    const para = firstParagraph(tree)
    expect(para.children).toHaveLength(2)
    expect((para.children[0] as Text).value).toBe('lead ')
    expect((para.children[1] as Link).url).toBe('/wikilink-resolve?title=End')
  })

  it('does not touch ordinary [text](url) links', async () => {
    const tree = await parse('[label](https://example.com)')
    const links = findLinks(tree)
    expect(links).toHaveLength(1)
    expect(links[0].url).toBe('https://example.com')
  })

  it('does not match nested or unbalanced brackets like [[X]', async () => {
    const tree = await parse('[[X]')
    const links = findLinks(tree)
    expect(links).toHaveLength(0)
  })
})

import remarkStringify from 'remark-stringify'

it('rewrites href to resolved URL when resolver returns one', async () => {
  const out = String(
    await unified()
      .use(remarkParse)
      .use(wikilinks, {
        resolve: (anchor: string) =>
          anchor === 'Pattern X' ? { url: '/alice/post/pattern-x' } : null,
      })
      .use(remarkStringify)
      .process('see [[Pattern X]] and [[Unknown]]'),
  )
  expect(out).toContain('](/alice/post/pattern-x)')
  expect(out).toContain('](/wikilink-resolve?title=Unknown)')
})

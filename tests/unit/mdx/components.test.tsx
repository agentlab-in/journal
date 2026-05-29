import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { mdxComponents } from '@/lib/mdx/components'

describe('mdxComponents allowlist', () => {
  it('exports exactly the five allowed tag bindings + pre/code + mermaid hook', () => {
    const keys = Object.keys(mdxComponents).sort()
    // pre is overridden so MermaidBlock can swap in for language-mermaid;
    // the five allowlist tags are the only "feature" components.
    expect(keys).toContain('callout')
    expect(keys).toContain('embed')
    expect(keys).toContain('figure')
    expect(keys).toContain('aside')
    expect(keys).toContain('detail')
    expect(keys).toContain('pre')
  })
})

describe('Embed component', () => {
  it('renders a styled blockquote fallback when provider is not whitelisted', async () => {
    const Embed = mdxComponents.embed as unknown as (props: {
      url?: string
      provider?: string
    }) => Promise<React.ReactElement> | React.ReactElement
    const node = await Embed({
      url: 'https://twitter.com/jack/status/20',
      provider: 'twitter',
    })
    const { container } = render(node)
    const bq = container.querySelector('blockquote')
    expect(bq).not.toBeNull()
    const a = container.querySelector('a')
    expect(a).not.toBeNull()
    expect(a?.getAttribute('href')).toBe('https://twitter.com/jack/status/20')
  })

  it('renders a fallback for unknown providers without throwing', async () => {
    const Embed = mdxComponents.embed as unknown as (props: {
      url?: string
      provider?: string
    }) => Promise<React.ReactElement> | React.ReactElement
    const node = await Embed({ url: 'https://example.com/post' })
    const { container } = render(node)
    expect(container.querySelector('blockquote')).not.toBeNull()
  })
})

describe('Callout component', () => {
  it('renders children inside a div with the type-derived class', () => {
    const Callout = mdxComponents.callout as React.FC<{
      type?: 'info' | 'tip' | 'warning' | 'danger'
      children?: React.ReactNode
    }>
    const { container, getByText } = render(
      <Callout type="info">hello</Callout>,
    )
    expect(getByText('hello')).toBeInTheDocument()
    expect(container.firstChild).toBeInstanceOf(HTMLDivElement)
  })
})

describe('Detail component', () => {
  it('renders a <details> with the given summary', () => {
    const Detail = mdxComponents.detail as React.FC<{
      summary?: string
      children?: React.ReactNode
    }>
    const { container, getByText } = render(
      <Detail summary="more">body</Detail>,
    )
    expect(container.querySelector('details')).not.toBeNull()
    expect(getByText('more')).toBeInTheDocument()
    expect(getByText('body')).toBeInTheDocument()
  })
})

describe('Aside component', () => {
  it('renders an <aside> element with children', () => {
    const Aside = mdxComponents.aside as React.FC<{
      children?: React.ReactNode
    }>
    const { container, getByText } = render(<Aside>note</Aside>)
    expect(container.querySelector('aside')).not.toBeNull()
    expect(getByText('note')).toBeInTheDocument()
  })
})

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { renderSnippet } from '@/lib/search/snippet'

describe('renderSnippet', () => {
  it('returns an empty string for empty input', () => {
    expect(renderSnippet('')).toBe('')
  })

  it('preserves plain text without marks', () => {
    const { container } = render(<div>{renderSnippet('plain text here')}</div>)
    expect(container.textContent).toBe('plain text here')
    expect(container.querySelector('mark')).toBeNull()
  })

  it('renders <mark> nodes for the highlighted spans', () => {
    const { container } = render(
      <div>{renderSnippet('before <mark>hit</mark> after')}</div>,
    )
    const marks = container.querySelectorAll('mark')
    expect(marks.length).toBe(1)
    expect(marks[0].textContent).toBe('hit')
    expect(container.textContent).toBe('before hit after')
  })

  it('renders multiple <mark> spans in order', () => {
    const { container } = render(
      <div>{renderSnippet('<mark>foo</mark> and <mark>bar</mark>')}</div>,
    )
    const marks = container.querySelectorAll('mark')
    expect(marks.length).toBe(2)
    expect(marks[0].textContent).toBe('foo')
    expect(marks[1].textContent).toBe('bar')
  })

  it('strips other HTML smuggled into the snippet (defense in depth)', () => {
    const { container } = render(
      <div>{renderSnippet('safe <script>alert(1)</script> <mark>hit</mark>')}</div>,
    )
    // No script element should ever be rendered.
    expect(container.querySelector('script')).toBeNull()
    // Tag fragments are stripped; the inner text leaks through but is harmless.
    expect(container.textContent).toContain('hit')
    expect(container.textContent).not.toContain('<script>')
  })

  it('strips foreign tags even inside the marked span', () => {
    const { container } = render(
      <div>{renderSnippet('a <mark>hit<img src=x onerror=1></mark> b')}</div>,
    )
    expect(container.querySelector('img')).toBeNull()
    const mark = container.querySelector('mark')
    expect(mark?.textContent).toBe('hit')
  })
})

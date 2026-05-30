/**
 * <NavSearch /> — top-nav search input + '/' focus shortcut.
 *
 * The form is plain HTML (GET /search?q=...) — no JS needed for submission.
 * The only behavior worth testing is the global keydown handler:
 *  - '/' focuses the input when nothing focusable is taking text input
 *  - '/' is a no-op while another text input/textarea has focus
 *  - modifier-shifted '/' (Ctrl+/, etc.) is suppressed
 */
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import NavSearch from '@/components/layout/NavSearch'

afterEach(() => {
  cleanup()
})

describe('<NavSearch>', () => {
  it('renders a GET form pointing at /search with a name="q" search input', () => {
    const { container } = render(<NavSearch />)

    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    expect(form?.getAttribute('action')).toBe('/search')
    // jsdom lowercases method; the attribute itself is "get".
    expect(form?.getAttribute('method')).toBe('get')
    expect(form?.getAttribute('role')).toBe('search')

    const input = screen.getByLabelText(/search posts/i) as HTMLInputElement
    expect(input.type).toBe('search')
    expect(input.name).toBe('q')
  })

  it("'/' keydown focuses the search input when nothing else is focused", () => {
    render(<NavSearch />)
    const input = screen.getByLabelText(/search posts/i) as HTMLInputElement

    // Sanity: not focused yet.
    expect(document.activeElement).not.toBe(input)

    fireEvent.keyDown(window, { key: '/' })

    expect(document.activeElement).toBe(input)
  })

  it("'/' keydown does NOT steal focus from a focused <textarea>", () => {
    render(
      <>
        <textarea data-testid="ta" defaultValue="" />
        <NavSearch />
      </>,
    )
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement
    const input = screen.getByLabelText(/search posts/i) as HTMLInputElement
    ta.focus()
    expect(document.activeElement).toBe(ta)

    fireEvent.keyDown(window, { key: '/' })

    expect(document.activeElement).toBe(ta)
    expect(document.activeElement).not.toBe(input)
  })

  it("'/' keydown does NOT steal focus from a focused text <input>", () => {
    render(
      <>
        <input data-testid="text" type="text" />
        <NavSearch />
      </>,
    )
    const text = screen.getByTestId('text') as HTMLInputElement
    const input = screen.getByLabelText(/search posts/i) as HTMLInputElement
    text.focus()
    expect(document.activeElement).toBe(text)

    fireEvent.keyDown(window, { key: '/' })

    expect(document.activeElement).toBe(text)
    expect(document.activeElement).not.toBe(input)
  })

  it("Ctrl+'/' does NOT trigger focus (modifier guard)", () => {
    render(<NavSearch />)
    const input = screen.getByLabelText(/search posts/i) as HTMLInputElement

    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    expect(document.activeElement).not.toBe(input)

    fireEvent.keyDown(window, { key: '/', metaKey: true })
    expect(document.activeElement).not.toBe(input)

    fireEvent.keyDown(window, { key: '/', altKey: true })
    expect(document.activeElement).not.toBe(input)
  })
})

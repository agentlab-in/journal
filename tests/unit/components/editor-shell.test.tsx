/**
 * EditorShell — composition tests
 *
 * Sub-components (CodeMirror, MDXRemote preview, tag/cover pickers, draft
 * manager) are mocked so we can exercise the shell's wiring without
 * standing up a fetch server. The mocks render simple test ids so the
 * harness can assert presence and feed state changes through onChange.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditorShell } from '@/components/editor/EditorShell'

// ---- Mocks ---------------------------------------------------------------
// We mock heavyweight client components because:
//   - CodeMirror uses @uiw/react-codemirror which renders an actual editor
//     that's awkward to drive in jsdom.
//   - PreviewPane fires fetch() against /api/mdx/preview which jsdom can't
//     route. We don't need to assert preview output here — separate tests
//     cover the preview pane itself.
//   - TagPicker / CoverImagePicker also hit /api endpoints on mount.

vi.mock('@/components/editor/CodeMirrorEditor', () => ({
  CodeMirrorEditor: (props: {
    value: string
    onChange: (next: string) => void
  }) => (
    <textarea
      data-testid="mock-cm"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
}))

vi.mock('@/components/editor/PreviewPane', () => ({
  PreviewPane: (props: { body_md: string }) => (
    <div data-testid="mock-preview">{props.body_md}</div>
  ),
}))

interface MockTagOption {
  slug: string
  name: string
  parent_tag_slug: string | null
}

vi.mock('@/components/editor/TagPicker', () => ({
  TagPicker: (props: {
    selected: MockTagOption[]
    onChange: (next: MockTagOption[]) => void
  }) => (
    <div data-testid="mock-tag-picker">
      <button
        type="button"
        onClick={() =>
          props.onChange([
            ...props.selected,
            { slug: 'rag', name: 'rag', parent_tag_slug: null },
          ])
        }
      >
        add-tag
      </button>
      <span>tags:{props.selected.length}</span>
    </div>
  ),
}))

vi.mock('@/components/editor/CoverImagePicker', () => ({
  CoverImagePicker: () => <div data-testid="mock-cover" />,
}))

vi.mock('@/components/editor/DraftManager', () => ({
  DraftManager: () => <div data-testid="mock-draft" />,
}))

vi.mock('@/components/editor/PublishAsSelect', () => ({
  PublishAsSelect: (props: { currentUsername: string }) => (
    <div data-testid="mock-publish-as">@{props.currentUsername}</div>
  ),
}))

beforeEach(() => {
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('<EditorShell> — initial render', () => {
  it('renders all sub-components for a new post', () => {
    render(<EditorShell mode="new" currentUsername="alice" />)
    expect(screen.getByTestId('mock-cm')).toBeInTheDocument()
    expect(screen.getByTestId('mock-preview')).toBeInTheDocument()
    expect(screen.getByTestId('mock-tag-picker')).toBeInTheDocument()
    expect(screen.getByTestId('mock-cover')).toBeInTheDocument()
    expect(screen.getByTestId('mock-draft')).toBeInTheDocument()
    expect(screen.getByTestId('mock-publish-as')).toHaveTextContent('@alice')
  })

  it('renders the slug preview, reflecting the title', () => {
    render(<EditorShell mode="new" currentUsername="alice" />)
    const slugRow = screen.getByTestId('slug-preview')
    // Empty title: trailing slash only
    expect(slugRow).toHaveTextContent('agentlab.in/alice/post/')

    // Typing a title updates the slug
    const titleInput = screen.getByLabelText(/title/i)
    fireEvent.change(titleInput, { target: { value: 'My Great Post' } })
    expect(screen.getByTestId('slug-preview')).toHaveTextContent(
      'agentlab.in/alice/post/my-great-post',
    )
  })
})

describe('<EditorShell> — type picker', () => {
  it('inserts the playbook template when type changes from post → playbook', () => {
    render(<EditorShell mode="new" currentUsername="alice" />)
    const playbookRadio = screen.getByLabelText(/playbook/i)
    fireEvent.click(playbookRadio)

    const cm = screen.getByTestId('mock-cm') as HTMLTextAreaElement
    expect(cm.value).toContain('## Environment / Target')
    expect(cm.value).toContain('## Prerequisites')
    expect(cm.value).toContain('## Core Instructions')
    expect(cm.value).toContain('## Safety / Failure Modes')
  })

  it('inserts the deep dive template when type changes from post → dive', () => {
    render(<EditorShell mode="new" currentUsername="alice" />)
    const diveRadio = screen.getByLabelText(/deep dive/i)
    fireEvent.click(diveRadio)

    const cm = screen.getByTestId('mock-cm') as HTMLTextAreaElement
    expect(cm.value).toContain('## TL;DR')
    expect(cm.value).toContain('## The Question')
  })
})

describe('<EditorShell> — publish button', () => {
  it('is disabled with no fields', () => {
    render(<EditorShell mode="new" currentUsername="alice" />)
    const publishBtn = screen.getByRole('button', { name: /^publish/i })
    expect(publishBtn).toBeDisabled()
    // Tooltip / title attribute should explain why
    expect(publishBtn.getAttribute('title')).toMatch(/title|summary|body|tag/i)
  })

  it('becomes enabled when all validation rules pass', () => {
    render(<EditorShell mode="new" currentUsername="alice" />)

    // Title
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'A great title' },
    })
    // Summary
    fireEvent.change(screen.getByLabelText(/summary/i), {
      target: { value: 'A summary at least ten chars long.' },
    })
    // Body via the mocked CodeMirror textarea
    fireEvent.change(screen.getByTestId('mock-cm'), {
      target: { value: 'x'.repeat(80) },
    })
    // Add a tag via the mocked tag picker
    fireEvent.click(screen.getByRole('button', { name: /add-tag/i }))

    const publishBtn = screen.getByRole('button', { name: /^publish/i })
    expect(publishBtn).not.toBeDisabled()
  })

  it('alerts on click that publishing will be wired in Phase 4', () => {
    render(<EditorShell mode="new" currentUsername="alice" />)
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'A great title' },
    })
    fireEvent.change(screen.getByLabelText(/summary/i), {
      target: { value: 'A summary at least ten chars long.' },
    })
    fireEvent.change(screen.getByTestId('mock-cm'), {
      target: { value: 'x'.repeat(80) },
    })
    fireEvent.click(screen.getByRole('button', { name: /add-tag/i }))

    fireEvent.click(screen.getByRole('button', { name: /^publish/i }))
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringMatching(/phase 4/i),
    )
  })
})

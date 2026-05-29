/**
 * DraftManager tests — restore-prompt modal + clear flow.
 *
 * The auto-save timer is exercised manually here (vi.useFakeTimers) but the
 * E2E coverage in Task 11 also drives the real 30s path through a debounced
 * Playwright test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { DraftManager, type DraftFormState } from '@/components/editor/DraftManager'
import { DRAFT_NEW_KEY } from '@/lib/drafts'

const emptyFormState: DraftFormState = {
  title: '',
  summary: '',
  type: 'post',
  body_md: '',
  tags: [],
  structured_sections: null,
  cover_image_url: null,
}

function presetDraft(key: string, overrides: Record<string, unknown> = {}) {
  const draft = {
    title: 'Hello',
    summary: 'A summary',
    type: 'post' as const,
    body_md: '# heading',
    tags: ['x'],
    structured_sections: null,
    cover_image_url: null,
    savedAt: '2026-05-01T00:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  }
  localStorage.setItem(key, JSON.stringify(draft))
  return draft
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('<DraftManager> — restore prompt', () => {
  it('shows the restore modal when a saved draft exists on mount (mode=new)', () => {
    presetDraft(DRAFT_NEW_KEY)
    const onRestore = vi.fn()
    render(
      <DraftManager
        mode="new"
        formState={emptyFormState}
        onRestore={onRestore}
      />,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/restore your last draft/i)).toBeInTheDocument()
  })

  it('calls onRestore with the parsed draft when the user clicks Restore', () => {
    const draft = presetDraft(DRAFT_NEW_KEY)
    const onRestore = vi.fn()
    render(
      <DraftManager
        mode="new"
        formState={emptyFormState}
        onRestore={onRestore}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /restore/i }))
    expect(onRestore).toHaveBeenCalledTimes(1)
    const passed = onRestore.mock.calls[0][0]
    expect(passed.title).toBe(draft.title)
    expect(passed.body_md).toBe(draft.body_md)
    expect(passed.schemaVersion).toBe(1)
  })

  it('clears the storage key when the user clicks Discard', () => {
    presetDraft(DRAFT_NEW_KEY)
    const onRestore = vi.fn()
    render(
      <DraftManager
        mode="new"
        formState={emptyFormState}
        onRestore={onRestore}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /discard/i }))
    expect(localStorage.getItem(DRAFT_NEW_KEY)).toBeNull()
    // Modal closes
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onRestore).not.toHaveBeenCalled()
  })

  it('does not show the modal when there is no stored draft', () => {
    const onRestore = vi.fn()
    render(
      <DraftManager
        mode="new"
        formState={emptyFormState}
        onRestore={onRestore}
      />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not show the modal when an edit-mode draft is older than the server post', () => {
    // edit-mode: server has updated_at > savedAt → server is newer → conflict
    // modal shown. Inverse: when server is older (or equal), the normal
    // restore modal appears. This test exercises the normal case (server is
    // OLDER → normal restore).
    presetDraft('agentlab.draft.edit.post-1', {
      savedAt: '2026-05-10T00:00:00.000Z',
    })
    const onRestore = vi.fn()
    render(
      <DraftManager
        mode="edit"
        postId="post-1"
        formState={emptyFormState}
        onRestore={onRestore}
        serverUpdatedAt="2026-05-01T00:00:00.000Z"
      />,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Should NOT be the conflict variant
    expect(
      screen.queryByText(/edited elsewhere/i),
    ).not.toBeInTheDocument()
  })

  it('shows a conflict modal in edit mode when the server post is newer than the draft', () => {
    presetDraft('agentlab.draft.edit.post-1', {
      savedAt: '2026-05-01T00:00:00.000Z',
    })
    const onRestore = vi.fn()
    render(
      <DraftManager
        mode="edit"
        postId="post-1"
        formState={emptyFormState}
        onRestore={onRestore}
        serverUpdatedAt="2026-05-10T00:00:00.000Z"
      />,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/edited elsewhere/i)).toBeInTheDocument()
  })
})

describe('<DraftManager> — auto-save', () => {
  it('debounces saves: only writes after the 30s timer elapses since the last change', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <DraftManager
        mode="new"
        formState={{
          title: 'a',
          summary: '',
          type: 'post',
          body_md: '',
          tags: [],
          structured_sections: null,
          cover_image_url: null,
        }}
        onRestore={() => {}}
      />,
    )
    expect(localStorage.getItem(DRAFT_NEW_KEY)).toBeNull()

    act(() => {
      vi.advanceTimersByTime(20_000)
    })
    expect(localStorage.getItem(DRAFT_NEW_KEY)).toBeNull()

    // Change before 30s elapses — timer resets
    rerender(
      <DraftManager
        mode="new"
        formState={{
          title: 'ab',
          summary: '',
          type: 'post',
          body_md: '',
          tags: [],
          structured_sections: null,
          cover_image_url: null,
        }}
        onRestore={() => {}}
      />,
    )
    act(() => {
      vi.advanceTimersByTime(20_000)
    })
    // Still not saved — timer was reset
    expect(localStorage.getItem(DRAFT_NEW_KEY)).toBeNull()

    // Now wait the remaining 10s
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    const raw = localStorage.getItem(DRAFT_NEW_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string)
    expect(parsed.title).toBe('ab')
    expect(parsed.schemaVersion).toBe(1)
  })

  it('does not overwrite the stored draft while the restore modal is open', () => {
    // Regression: previously the auto-save effect ran even while the modal
    // was shown, so the on-disk draft got clobbered by the empty form state
    // before the user could click Restore.
    vi.useFakeTimers()
    const stored = presetDraft(DRAFT_NEW_KEY, { title: 'Pre-existing' })
    render(
      <DraftManager
        mode="new"
        formState={emptyFormState}
        onRestore={() => {}}
      />,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    const raw = localStorage.getItem(DRAFT_NEW_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string)
    expect(parsed.title).toBe(stored.title)
  })
})

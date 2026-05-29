'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  DRAFT_NEW_KEY,
  draftEditKey,
  loadDraft,
  saveDraft,
  clearDraft,
  hasNewerServerVersion,
  type Draft,
} from '@/lib/drafts'

export type DraftFormState = Omit<Draft, 'savedAt' | 'schemaVersion'>

export interface DraftManagerProps {
  mode: 'new' | 'edit'
  postId?: string
  formState: DraftFormState
  onRestore: (restored: Draft) => void
  serverUpdatedAt?: string | null
  /**
   * Auto-save debounce in milliseconds. Defaults to 30_000 (30s) to match
   * production behaviour; E2E tests pass a small value (e.g. 500) so they
   * don't have to wait 30s for a debounce to fire.
   */
  autoSaveMs?: number
}

export interface DraftManagerHandle {
  clearOnSubmit: () => void
  /** Alias for clearOnSubmit — used by the Phase 4 publish handler. */
  clearDraft: () => void
}

const DEFAULT_AUTOSAVE_DELAY_MS = 30_000

type ModalKind = 'restore' | 'conflict' | null

function relativeTime(from: Date, to: Date): string {
  const ms = to.getTime() - from.getTime()
  const s = Math.max(1, Math.floor(ms / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export const DraftManager = forwardRef<DraftManagerHandle, DraftManagerProps>(
  function DraftManager(
    {
      mode,
      postId,
      formState,
      onRestore,
      serverUpdatedAt,
      autoSaveMs = DEFAULT_AUTOSAVE_DELAY_MS,
    },
    ref,
  ) {
    const storageKey = useMemo(() => {
      if (mode === 'edit') {
        if (!postId) {
          throw new Error('DraftManager: postId is required when mode="edit"')
        }
        return draftEditKey(postId)
      }
      return DRAFT_NEW_KEY
    }, [mode, postId])

    const [modal, setModal] = useState<ModalKind>(null)
    const [pendingDraft, setPendingDraft] = useState<Draft | null>(null)
    const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
    const [now, setNow] = useState<Date>(() => new Date())

    // On mount, check for an existing draft.
    useEffect(() => {
      const draft = loadDraft(storageKey)
      if (!draft) return
      setPendingDraft(draft)
      setLastSavedAt(draft.savedAt)
      if (
        mode === 'edit' &&
        serverUpdatedAt &&
        hasNewerServerVersion(draft, { updated_at: serverUpdatedAt })
      ) {
        setModal('conflict')
      } else {
        setModal('restore')
      }
      // Intentionally run only on mount: we want the prompt once per session.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Debounced auto-save: every formState change resets the timer. The
    // delay is configurable via the `autoSaveMs` prop so E2E tests can avoid
    // a 30s wait. Pauses while a restore/conflict modal is open so the
    // initial empty form doesn't clobber the on-disk draft before the user
    // decides whether to Restore.
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => {
      if (modal !== null) return
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        const saved = saveDraft(storageKey, formState)
        setLastSavedAt(saved.savedAt)
      }, autoSaveMs)
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current)
      }
    }, [formState, storageKey, autoSaveMs, modal])

    // Update the "Xs ago" label once a second.
    useEffect(() => {
      const id = setInterval(() => setNow(new Date()), 1000)
      return () => clearInterval(id)
    }, [])

    const handleRestore = useCallback(() => {
      if (pendingDraft) onRestore(pendingDraft)
      setModal(null)
    }, [pendingDraft, onRestore])

    const handleDiscard = useCallback(() => {
      clearDraft(storageKey)
      setPendingDraft(null)
      setLastSavedAt(null)
      setModal(null)
    }, [storageKey])

    const handleKeepLocal = useCallback(() => {
      // Conflict variant: user chose to keep their local edits.
      if (pendingDraft) onRestore(pendingDraft)
      setModal(null)
    }, [pendingDraft, onRestore])

    useImperativeHandle(
      ref,
      () => ({
        clearOnSubmit: () => {
          clearDraft(storageKey)
          setLastSavedAt(null)
        },
        clearDraft: () => {
          clearDraft(storageKey)
          setLastSavedAt(null)
        },
      }),
      [storageKey],
    )

    const status = lastSavedAt
      ? `draft saved ${relativeTime(new Date(lastSavedAt), now)}`
      : 'no draft saved yet'

    return (
      <>
        <div className="text-xs text-fg-subtle" data-testid="draft-status">
          {status}
        </div>

        {modal === 'restore' && pendingDraft ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="draft-restore-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          >
            <div className="w-full max-w-md rounded-md border border-border bg-bg p-5 shadow-lg">
              <h2
                id="draft-restore-title"
                className="text-base font-semibold text-fg"
              >
                Restore your last draft?
              </h2>
              <p className="mt-2 text-sm text-fg-subtle">
                We saved your work in this browser at{' '}
                {new Date(pendingDraft.savedAt).toLocaleString()}.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleDiscard}
                  className="rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg hover:bg-bg-hover"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={handleRestore}
                  className="rounded-md border border-border bg-fg px-3 py-1.5 text-sm text-bg hover:opacity-90"
                >
                  Restore
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {modal === 'conflict' && pendingDraft ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="draft-conflict-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          >
            <div className="w-full max-w-md rounded-md border border-border bg-bg p-5 shadow-lg">
              <h2
                id="draft-conflict-title"
                className="text-base font-semibold text-fg"
              >
                This post was edited elsewhere
              </h2>
              <p className="mt-2 text-sm text-fg-subtle">
                The server copy was updated after your last local save. Keep
                your local draft, or discard it and use the server version?
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleDiscard}
                  className="rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg hover:bg-bg-hover"
                >
                  Discard local
                </button>
                <button
                  type="button"
                  onClick={handleKeepLocal}
                  className="rounded-md border border-border bg-fg px-3 py-1.5 text-sm text-bg hover:opacity-90"
                >
                  Keep local
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </>
    )
  },
)

export default DraftManager

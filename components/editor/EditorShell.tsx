'use client'

/**
 * EditorShell — top-level client composition for /write and /write/[postId].
 *
 * Composes:
 *   - Top bar: type picker, title, summary (with counter), TagPicker,
 *     CoverImagePicker, PublishAsSelect, Publish button.
 *   - Slug preview line (read-only, live).
 *   - Editor pane: CodeMirrorEditor with a small toolbar (insert image,
 *     insert pattern template for Post type).
 *   - Preview pane: PreviewPane, debounced server-driven compile.
 *   - Footer: DraftManager status (also renders restore / conflict modal).
 *
 * Layout: CSS grid with a draggable column divider between editor and
 * preview. Divider state is plain React state on `gridTemplateColumns`.
 *
 * Type-switch behaviour: if the current body exactly matches the previous
 * type's template (i.e. the author hasn't typed anything yet), we swap to
 * the new template. Otherwise we leave the body alone — the author's
 * content is precious, and reconciling sections across types is out of
 * scope for v1.
 *
 * Publish action is stubbed (alert) per the Phase 3 brief; wiring lands
 * in Phase 4.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { useRouter } from 'next/navigation'
import { CodeMirrorEditor, type CodeMirrorEditorApi } from './CodeMirrorEditor'
import { PreviewPane } from './PreviewPane'
import { TagPicker, type TagOption } from './TagPicker'
import { CoverImagePicker } from './CoverImagePicker'
import {
  DraftManager,
  type DraftManagerHandle,
  type DraftFormState,
} from './DraftManager'
import { PublishAsSelect } from './PublishAsSelect'
import { slug as toSlug } from '@/lib/posts/slug'
import {
  validatePublishable,
  BODY_TEMPLATES,
  PATTERN_TEMPLATE,
} from '@/lib/editor/validate'
import type { Draft, DraftType } from '@/lib/drafts'

export interface InitialPost {
  id: string
  title: string
  summary: string
  type: DraftType
  body_md: string
  cover_image_url: string | null
  structured_sections: Record<string, string> | null
  edited_at: string | null
  published_at: string
}

export interface EditorShellProps {
  mode: 'new' | 'edit'
  /** Author's canonical username for the slug preview + publish-as label. */
  currentUsername: string
  /**
   * The post ID when mode='edit'. Required so the publish handler can target
   * PATCH /api/posts/<editPostId>.
   */
  editPostId?: string
  initialPost?: InitialPost
  initialTags?: TagOption[]
  /**
   * Optional override for the DraftManager auto-save debounce. Used by E2E
   * tests so the test doesn't have to wait the production 30s for a draft
   * to be persisted. If undefined, DraftManager uses its built-in default.
   */
  autoSaveMs?: number
}

const SUMMARY_MAX = 200
const SUMMARY_MIN = 10
const TITLE_MIN = 5

interface UploadErrorBody {
  error?: string
}

export function EditorShell({
  mode,
  currentUsername,
  editPostId,
  initialPost,
  initialTags,
  autoSaveMs,
}: EditorShellProps) {
  const router = useRouter()
  // ---- form state --------------------------------------------------------
  const [title, setTitle] = useState<string>(initialPost?.title ?? '')
  const [summary, setSummary] = useState<string>(initialPost?.summary ?? '')
  const [type, setType] = useState<DraftType>(initialPost?.type ?? 'post')
  const [bodyMd, setBodyMd] = useState<string>(initialPost?.body_md ?? '')
  const [tags, setTags] = useState<TagOption[]>(initialTags ?? [])
  const [structuredSections, setStructuredSections] = useState<Record<
    string,
    string
  > | null>(initialPost?.structured_sections ?? null)
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(
    initialPost?.cover_image_url ?? null,
  )

  // ---- imperative APIs ---------------------------------------------------
  const editorApiRef = useRef<CodeMirrorEditorApi | null>(null)
  const draftRef = useRef<DraftManagerHandle | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  // Ref to the latest handlePublish so the keyboard listener never
  // captures a stale closure (deps change every keystroke).
  const handlePublishRef = useRef<() => Promise<void> | void>(() => {})
  const canPublishRef = useRef<boolean>(false)

  const handleEditorReady = useCallback((api: CodeMirrorEditorApi) => {
    editorApiRef.current = api
  }, [])

  // ---- type picker: replace body only when it still equals the old template
  const handleTypeChange = useCallback(
    (next: DraftType) => {
      if (next === type) return
      const previousTemplate = BODY_TEMPLATES[type]
      const isUntouched = bodyMd === previousTemplate || bodyMd === ''
      if (isUntouched) {
        setBodyMd(BODY_TEMPLATES[next])
      }
      setType(next)
    },
    [type, bodyMd],
  )

  // ---- restore draft -----------------------------------------------------
  const handleRestore = useCallback((draft: Draft) => {
    setTitle(draft.title)
    setSummary(draft.summary)
    setType(draft.type)
    setBodyMd(draft.body_md)
    setStructuredSections(draft.structured_sections)
    setCoverImageUrl(draft.cover_image_url)
    // Render chips immediately so the picker isn't blank; mark them all
    // pending until the server tells us otherwise.
    setTags(
      draft.tags.map((s) => ({
        slug: s,
        name: s,
        parent_tag_slug: null,
        pending: true,
      })),
    )
    // Then re-check each slug against /api/tags/search so approved tags
    // drop the (new) label and recover their canonical name + parent.
    // Fire-and-forget: each chip updates when its lookup resolves.
    void Promise.all(
      draft.tags.map(async (s) => {
        try {
          const res = await fetch(
            `/api/tags/search?q=${encodeURIComponent(s)}`,
          )
          if (!res.ok) return null
          const json = (await res.json()) as {
            tags: {
              slug: string
              name: string
              parent_tag_slug: string | null
            }[]
          }
          return json.tags.find((t) => t.slug === s) ?? null
        } catch {
          return null
        }
      }),
    ).then((results) => {
      setTags((prev) =>
        prev.map((t) => {
          const i = draft.tags.indexOf(t.slug)
          const match = i >= 0 ? results[i] : null
          if (!match) return t
          return {
            slug: match.slug,
            name: match.name,
            parent_tag_slug: match.parent_tag_slug,
            pending: false,
          }
        }),
      )
    })
  }, [])

  // ---- form state derivation --------------------------------------------
  const draftFormState: DraftFormState = useMemo(
    () => ({
      title,
      summary,
      type,
      body_md: bodyMd,
      tags: tags.map((t) => t.slug),
      structured_sections: structuredSections,
      cover_image_url: coverImageUrl,
    }),
    [title, summary, type, bodyMd, tags, structuredSections, coverImageUrl],
  )

  const slugPreview = useMemo(() => toSlug(title), [title])

  // ---- validation --------------------------------------------------------
  const validation = useMemo(
    () =>
      validatePublishable({
        title,
        summary,
        body_md: bodyMd,
        type,
        tags,
        structured_sections: structuredSections,
      }),
    [title, summary, bodyMd, type, tags, structuredSections],
  )

  // ---- column divider ----------------------------------------------------
  // `editorFraction` is a 0..1 fraction of the available split width.
  const [editorFraction, setEditorFraction] = useState(0.5)
  const splitRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)

  // ---- mobile pane switcher ----------------------------------------------
  // Below the `lg` breakpoint the split-pane stacks into a single column
  // and the author flips between editing and previewing with a tab
  // control. On `lg` and up both panes show side-by-side and `view` is
  // ignored (the CSS `lg:` modifier overrides the `hidden` toggles).
  const [view, setView] = useState<'edit' | 'preview'>('edit')

  const handleDividerPointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const handleDividerPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return
    const container = splitRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const next = (e.clientX - rect.left) / rect.width
    // Clamp to keep both panes usable.
    setEditorFraction(Math.min(0.85, Math.max(0.15, next)))
  }, [])

  const handleDividerPointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }, [])

  // ---- toolbar actions ---------------------------------------------------
  const handleInsertPattern = useCallback(() => {
    editorApiRef.current?.insertAtCursor(PATTERN_TEMPLATE)
  }, [])

  const handleInsertImage = useCallback(() => {
    setUploadError(null)
    fileInputRef.current?.click()
  }, [])

  const handleImageSelected = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = '' // reset so the same file can be re-selected later
      if (!file) return
      setUploading(true)
      setUploadError(null)
      try {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/uploads?bucket=post-images', {
          method: 'POST',
          body: form,
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as UploadErrorBody
          setUploadError(body.error ?? 'upload_failed')
          return
        }
        const body = (await res.json()) as { url: string }
        editorApiRef.current?.insertAtCursor(`![](${body.url})\n`)
      } catch {
        setUploadError('upload_failed')
      } finally {
        setUploading(false)
      }
    },
    [],
  )

  // ---- publish handler ---------------------------------------------------
  const handlePublish = useCallback(async () => {
    if (validation.errors.length > 0) return
    setPublishing(true)
    setServerError(null)
    try {
      const url = mode === 'new' ? '/api/posts' : `/api/posts/${editPostId}`
      const method = mode === 'new' ? 'POST' : 'PATCH'
      const body: Record<string, unknown> = {
        title,
        summary,
        body_md: bodyMd,
        tags: tags.map((t) => t.slug),
        cover_image_url: coverImageUrl ?? undefined,
      }
      if (mode === 'new') body.type = type
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({})) as {
        url?: string
        error?: string
        issues?: Array<{ message: string }>
      }
      if (!res.ok) {
        setServerError(
          data?.issues?.[0]?.message ??
            data?.error ??
            `Publish failed (status ${res.status})`,
        )
        return
      }
      draftRef.current?.clearDraft()
      router.push(data.url!)
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setPublishing(false)
    }
  }, [
    validation.errors.length,
    mode,
    editPostId,
    title,
    summary,
    bodyMd,
    tags,
    coverImageUrl,
    type,
    router,
  ])

  // Tooltip / aria-description for the disabled state
  const publishTooltip = validation.valid
    ? publishing
      ? 'Publishing…'
      : 'Publish'
    : `Missing: ${validation.errors.join('; ')}`

  // ---- summary counter colour --------------------------------------------
  const summaryLen = summary.length
  const summaryClass =
    summaryLen > SUMMARY_MAX || (summaryLen > 0 && summaryLen < SUMMARY_MIN)
      ? 'text-red-700'
      : 'text-fg-subtle'

  // Force the title field to look invalid when it's non-empty but too short.
  const titleInvalid = title.length > 0 && title.trim().length < TITLE_MIN

  // We want to render a friendly fallback for missing username, but the
  // server should always supply one. Surface a sentinel so a bug here is
  // visible in dev rather than silently producing /agentlab.in//post/foo.
  const displayUsername = currentUsername || 'unknown'

  // Update the column-template style only when the fraction changes.
  useEffect(() => {
    // no-op; the inline style below already binds to editorFraction.
  }, [editorFraction])

  // Keep the keyboard shortcut closure pointing at the freshest
  // handlePublish + validity. Refs avoid re-attaching the window
  // listener on every keystroke, which is hot in CodeMirror.
  useEffect(() => {
    handlePublishRef.current = handlePublish
    canPublishRef.current = validation.valid && !publishing
  }, [handlePublish, validation.valid, publishing])

  // Global cmd/ctrl + Enter (publish) and cmd/ctrl + s (save draft now).
  // Mounted on `window` so the shortcut works even when focus is inside
  // CodeMirror (which swallows its own keydowns at the DOM-content
  // level). The handler is intentionally lightweight — all the real
  // logic lives behind refs so this listener mounts exactly once.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      // Enter → publish (when valid + not already publishing).
      if (e.key === 'Enter') {
        if (!canPublishRef.current) return
        e.preventDefault()
        void handlePublishRef.current()
        return
      }
      // s → manual draft save. Use lowercase compare so it fires for
      // both cmd+s and cmd+shift+s consistently.
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        draftRef.current?.saveNow()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="flex w-full flex-col gap-4 p-4">
      {/* ---- top bar -------------------------------------------------- */}
      <header className="grid gap-3 lg:grid-cols-[auto_1fr_1fr_auto] lg:items-end">
        {/* type picker */}
        <fieldset
          className="flex flex-col gap-1"
          aria-label="Post type"
          data-testid="type-picker"
        >
          <legend className="text-sm font-medium text-fg">Type</legend>
          <div className="inline-flex gap-1 rounded-md border border-border bg-bg-subtle p-1 text-sm">
            {(
              [
                { v: 'post', label: 'Post' },
                { v: 'playbook', label: 'Playbook' },
                { v: 'dive', label: 'Deep Dive' },
              ] as const
            ).map((opt) => (
              <label
                key={opt.v}
                className={`cursor-pointer rounded-sm px-2 py-1 ${
                  type === opt.v ? 'bg-bg text-fg' : 'text-fg-subtle'
                }`}
              >
                <input
                  type="radio"
                  name="post-type"
                  value={opt.v}
                  checked={type === opt.v}
                  onChange={() => handleTypeChange(opt.v)}
                  className="sr-only"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </fieldset>

        {/* title */}
        <div className="flex flex-col gap-1">
          <label htmlFor="post-title" className="text-sm font-medium text-fg">
            Title
          </label>
          <input
            id="post-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="A descriptive title"
            aria-invalid={titleInvalid || undefined}
            className={`rounded-md border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle ${
              titleInvalid ? 'border-red-500' : 'border-border'
            }`}
          />
        </div>

        {/* summary */}
        <div className="flex flex-col gap-1">
          <label htmlFor="post-summary" className="text-sm font-medium text-fg">
            Summary
            <span className={`ml-2 text-xs ${summaryClass}`}>
              {summaryLen}/{SUMMARY_MAX}
            </span>
          </label>
          <input
            id="post-summary"
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="One-liner that shows up on cards and feeds"
            className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle"
          />
        </div>

        {/* publish button */}
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            disabled={!validation.valid || publishing}
            onClick={() => void handlePublish()}
            title={publishTooltip}
            aria-describedby="publish-help"
            className="rounded-md bg-fg px-4 py-2 text-sm font-medium text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
          {serverError ? (
            <span
              className="text-xs text-red-700"
              role="alert"
              data-testid="publish-error"
            >
              {serverError}
            </span>
          ) : null}
        </div>
      </header>

      {/* ---- pickers row --------------------------------------------- */}
      <section className="grid gap-4 lg:grid-cols-3">
        <TagPicker selected={tags} onChange={setTags} />
        <CoverImagePicker value={coverImageUrl} onChange={setCoverImageUrl} />
        <PublishAsSelect currentUsername={displayUsername} />
      </section>

      {/* ---- slug preview -------------------------------------------- */}
      <div
        data-testid="slug-preview"
        className="font-mono text-xs text-fg-subtle"
        aria-label="Final URL preview"
      >
        agentlab.in/{displayUsername}/{type}/{slugPreview}
      </div>

      {/* ---- helper text under publish ------------------------------- */}
      {!validation.valid ? (
        <p
          id="publish-help"
          className="text-xs text-fg-subtle"
          data-testid="publish-help"
        >
          To publish: {validation.errors.join('; ')}
        </p>
      ) : (
        <p id="publish-help" className="sr-only">
          Ready to publish.
        </p>
      )}

      {/* ---- editor toolbar ----------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        <button
          type="button"
          onClick={handleInsertImage}
          disabled={uploading}
          className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg hover:bg-bg-hover disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Insert image'}
        </button>
        {type === 'post' ? (
          <button
            type="button"
            onClick={handleInsertPattern}
            className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg hover:bg-bg-hover"
          >
            Insert pattern template
          </button>
        ) : null}
        {uploadError ? (
          <span className="text-xs text-red-700" role="alert">
            {uploadError}
          </span>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => void handleImageSelected(e)}
        />
      </div>

      {/* ---- mobile tabs: Write / Preview (hidden on lg+) ----------- */}
      {/* Tailwind's default `lg` breakpoint (1024px) is the closest match
          to the spec's ~900px target. Discussion #23 notes the deviation
          — we prefer staying on default breakpoints over a custom one. */}
      <div
        role="tablist"
        aria-label="Editor view"
        className="flex gap-1 border-b border-border lg:hidden"
        data-testid="editor-view-tabs"
      >
        <button
          type="button"
          id="editor-tab-write"
          role="tab"
          aria-selected={view === 'edit'}
          aria-controls="editor-pane-write"
          onClick={() => setView('edit')}
          className={`px-3 py-2 text-sm font-medium ${
            view === 'edit'
              ? 'border-b-2 border-fg text-fg'
              : 'text-fg-subtle hover:text-fg'
          }`}
        >
          Write
        </button>
        <button
          type="button"
          id="editor-tab-preview"
          role="tab"
          aria-selected={view === 'preview'}
          aria-controls="editor-pane-preview"
          onClick={() => setView('preview')}
          className={`px-3 py-2 text-sm font-medium ${
            view === 'preview'
              ? 'border-b-2 border-fg text-fg'
              : 'text-fg-subtle hover:text-fg'
          }`}
        >
          Preview
        </button>
      </div>

      {/* ---- split: editor | divider | preview -----------------------
          Below `lg` (1024px) the layout collapses to a single column;
          the tabs above flip the `view` state which toggles `hidden` on
          each pane. On `lg` and up the grid restores its draggable
          two-column layout and `view` is irrelevant. */}
      <div
        ref={splitRef}
        className="flex w-full flex-col gap-0 lg:grid"
        style={{
          // The inline style only applies once `lg:grid` activates the
          // grid display mode — CSS resolves `gridTemplateColumns` against
          // a flex parent as a no-op. Keep the style inline so the
          // draggable divider can mutate it without a media-query dance.
          gridTemplateColumns: `${editorFraction}fr 6px ${1 - editorFraction}fr`,
        }}
      >
        <div
          id="editor-pane-write"
          role="tabpanel"
          aria-labelledby="editor-tab-write"
          className={`min-w-0 ${view === 'edit' ? '' : 'hidden'} lg:block`}
        >
          <CodeMirrorEditor
            value={bodyMd}
            onChange={setBodyMd}
            placeholder="Write your post in Markdown…"
            onReady={handleEditorReady}
          />
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize editor and preview"
          tabIndex={0}
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          onPointerUp={handleDividerPointerUp}
          className="hidden cursor-col-resize bg-border hover:bg-fg-subtle lg:block"
          data-testid="split-divider"
        />

        <div
          id="editor-pane-preview"
          role="tabpanel"
          aria-labelledby="editor-tab-preview"
          className={`relative min-w-0 overflow-auto lg:border-l lg:border-border lg:pl-4 ${
            view === 'preview' ? '' : 'hidden'
          } lg:block`}
        >
          <PreviewPane body_md={bodyMd} />
        </div>
      </div>

      {/* ---- footer: draft manager status --------------------------- */}
      <footer className="border-t border-border pt-2">
        <DraftManager
          ref={draftRef}
          mode={mode}
          postId={initialPost?.id}
          formState={draftFormState}
          onRestore={handleRestore}
          serverUpdatedAt={
            initialPost?.edited_at ?? initialPost?.published_at ?? null
          }
          autoSaveMs={autoSaveMs}
        />
      </footer>
    </div>
  )
}

export default EditorShell

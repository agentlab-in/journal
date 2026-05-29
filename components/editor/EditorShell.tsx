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
  initialPost,
  initialTags,
  autoSaveMs,
}: EditorShellProps) {
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

  // ---- publish stub ------------------------------------------------------
  const handlePublish = useCallback(() => {
    if (!validation.valid) return
    // Clear the draft so a future visit doesn't restore a stale copy.
    draftRef.current?.clearOnSubmit()
    window.alert('Publish is wired up in Phase 4')
  }, [validation])

  // Tooltip / aria-description for the disabled state
  const publishTooltip = validation.valid
    ? 'Publish'
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
        <div className="flex items-end">
          <button
            type="button"
            disabled={!validation.valid}
            onClick={handlePublish}
            title={publishTooltip}
            aria-describedby="publish-help"
            className="rounded-md bg-fg px-4 py-2 text-sm font-medium text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Publish
          </button>
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

      {/* ---- split: editor | divider | preview ----------------------- */}
      <div
        ref={splitRef}
        className="grid w-full gap-0"
        style={{
          gridTemplateColumns: `${editorFraction}fr 6px ${1 - editorFraction}fr`,
        }}
      >
        <div className="min-w-0">
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
          className="cursor-col-resize bg-border hover:bg-fg-subtle"
          data-testid="split-divider"
        />

        <div className="relative min-w-0 overflow-auto border-l border-border pl-4">
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

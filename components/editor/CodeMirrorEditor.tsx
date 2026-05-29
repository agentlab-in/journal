'use client'

/**
 * CodeMirrorEditor — markdown source editor for the write page.
 *
 * Props:
 *   value        - current document text (controlled).
 *   onChange     - fired with the next document text on every edit.
 *   placeholder  - example text shown when the doc is empty.
 *   onReady      - one-shot callback that hands the parent a tiny API
 *                  for programmatic edits (used by the Task 10 toolbar
 *                  to insert image markdown after a successful upload).
 *
 * Theme tracking:
 *   We mirror <html data-theme="…"> using a MutationObserver instead of
 *   subscribing to a React context. Rationale:
 *     1. ThemeToggle already mutates the DOM attribute directly; no
 *        single React context owns the theme right now.
 *     2. The CodeMirror instance only needs to re-render when the
 *        attribute changes — observing the DOM is the cheapest way to
 *        get that signal without forcing a global provider rewrite.
 *
 *   The package exposes a `theme` prop that accepts `"light" | "dark"`
 *   directly (confirmed via @uiw/react-codemirror's index.d.ts), so we
 *   simply pass the current value through.
 */
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import CodeMirror, {
  EditorView,
  type ReactCodeMirrorRef,
} from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'

export interface CodeMirrorEditorApi {
  /**
   * Insert text at the current selection (replacing it) and refocus the
   * editor. Used by the toolbar to drop `![alt](url)` after an upload.
   */
  insertAtCursor: (text: string) => void
}

export interface CodeMirrorEditorProps {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  onReady?: (api: CodeMirrorEditorApi) => void
  className?: string
  minHeight?: string
}

type Theme = 'light' | 'dark'

function getThemeSnapshot(): Theme {
  const attr = document.documentElement.getAttribute('data-theme')
  return attr === 'dark' ? 'dark' : 'light'
}

// SSR snapshot: always return the safe default so server output matches the
// pre-hydration client output and React doesn't flag a mismatch.
function getServerThemeSnapshot(): Theme {
  return 'light'
}

function subscribeTheme(callback: () => void): () => void {
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  return () => observer.disconnect()
}

export function CodeMirrorEditor({
  value,
  onChange,
  placeholder,
  onReady,
  className,
  minHeight = '420px',
}: CodeMirrorEditorProps) {
  // useSyncExternalStore subscribes to <html data-theme="…"> mutations
  // and re-renders this component (so the package's `theme` prop flips)
  // without needing setState-in-effect. See ThemeToggle.tsx for the same
  // pattern; we deliberately avoid a React context here because the
  // theme is owned by the DOM attribute, not by a React tree.
  const theme = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  )

  // The package returns `Extension[]`; markdown() + line wrapping is all
  // we need for Phase 3. Memoised so React doesn't tear down the editor
  // state every render.
  const extensions = useMemo(
    () => [markdown(), EditorView.lineWrapping],
    [],
  )

  // Ref onto the underlying ReactCodeMirror instance so we can reach the
  // EditorView for programmatic dispatch. The package types include
  // `view?: EditorView` on the ref payload.
  const cmRef = useRef<ReactCodeMirrorRef | null>(null)

  // Expose the imperative insertion API once, and only after the view
  // exists. Re-running this effect if `onReady` changes is intentional
  // (parents may memoise the callback or not — either way is fine).
  const handleCreate = useCallback(() => {
    if (!onReady) return
    onReady({
      insertAtCursor: (text: string) => {
        const view = cmRef.current?.view
        if (!view) return
        const { from, to } = view.state.selection.main
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        })
        view.focus()
      },
    })
  }, [onReady])

  const handleChange = useCallback(
    (next: string) => {
      onChange(next)
    },
    [onChange],
  )

  return (
    <div className={className} data-testid="codemirror-editor">
      <CodeMirror
        ref={cmRef}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        theme={theme}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          foldGutter: false,
          autocompletion: false,
        }}
        minHeight={minHeight}
        onCreateEditor={handleCreate}
      />
    </div>
  )
}

export default CodeMirrorEditor

'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { slug as toSlug } from '@/lib/posts/slug'

export interface TagOption {
  slug: string
  name: string
  parent_tag_slug: string | null
  pending?: boolean
}

export interface TagPickerProps {
  selected: TagOption[]
  onChange: (next: TagOption[]) => void
  maxTags?: number
}

interface FetchedTag {
  slug: string
  name: string
  parent_tag_slug: string | null
}

const DEBOUNCE_MS = 200
const DROPDOWN_LIMIT = 10

function display(tag: Pick<FetchedTag, 'slug' | 'parent_tag_slug'>): string {
  return tag.parent_tag_slug ? `${tag.parent_tag_slug}/${tag.slug}` : tag.slug
}

export function TagPicker({ selected, onChange, maxTags = 5 }: TagPickerProps) {
  const inputId = useId()
  const listboxId = `${inputId}-listbox`
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FetchedTag[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const atMax = selected.length >= maxTags
  const selectedSlugs = useMemo(
    () => new Set(selected.map((s) => s.slug)),
    [selected],
  )

  const suggestedSlug = useMemo(() => {
    const q = query.trim()
    if (q.length === 0) return null
    return toSlug(q) || null
  }, [query])

  const exactMatchInResults = useMemo(() => {
    if (!suggestedSlug) return false
    return results.some((r) => r.slug === suggestedSlug)
  }, [results, suggestedSlug])

  // Debounced fetch on query change.
  useEffect(() => {
    const handle = setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      setError(null)
      const url = `/api/tags/search${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`
      fetch(url, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const json = (await res.json()) as { tags: FetchedTag[] }
          setResults(json.tags.slice(0, DROPDOWN_LIMIT))
          setLoading(false)
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === 'AbortError') return
          setLoading(false)
          setError('Could not load tags')
          setResults([])
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [query])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const visibleOptions = useMemo(() => {
    return results.filter((r) => !selectedSlugs.has(r.slug))
  }, [results, selectedSlugs])

  const showSuggestRow =
    suggestedSlug !== null &&
    !exactMatchInResults &&
    !selectedSlugs.has(suggestedSlug)

  const totalRows = visibleOptions.length + (showSuggestRow ? 1 : 0)
  // Clamp the highlighted row to whatever's currently rendered. Computed
  // during render so we don't trigger a follow-up commit via setState.
  const clampedActiveIndex = Math.min(activeIndex, Math.max(0, totalRows - 1))

  const addTag = useCallback(
    (tag: TagOption) => {
      if (atMax) return
      if (selectedSlugs.has(tag.slug)) return
      onChange([...selected, tag])
      setQuery('')
      setOpen(false)
      setActiveIndex(0)
    },
    [atMax, selected, selectedSlugs, onChange],
  )

  const removeTag = useCallback(
    (s: string) => {
      onChange(selected.filter((t) => t.slug !== s))
    },
    [selected, onChange],
  )

  const selectAtIndex = useCallback(
    (i: number) => {
      if (i < visibleOptions.length) {
        const t = visibleOptions[i]
        addTag({
          slug: t.slug,
          name: t.name,
          parent_tag_slug: t.parent_tag_slug,
        })
      } else if (showSuggestRow && suggestedSlug) {
        addTag({
          slug: suggestedSlug,
          name: query.trim(),
          parent_tag_slug: null,
          pending: true,
        })
      }
    },
    [visibleOptions, showSuggestRow, suggestedSlug, query, addTag],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
        setActiveIndex((i) => Math.min(totalRows - 1, i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (!atMax && totalRows > 0) selectAtIndex(clampedActiveIndex)
      } else if (e.key === 'Escape') {
        setOpen(false)
      } else if (e.key === 'Backspace' && query === '' && selected.length > 0) {
        removeTag(selected[selected.length - 1].slug)
      }
    },
    [
      totalRows,
      clampedActiveIndex,
      atMax,
      selectAtIndex,
      query,
      selected,
      removeTag,
    ],
  )

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-fg">
        Tags
        <span className="ml-2 text-xs text-fg-subtle">
          {selected.length}/{maxTags}
        </span>
      </label>

      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" data-testid="tag-chips">
          {selected.map((t) => (
            <li
              key={t.slug}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-subtle px-2 py-0.5 text-xs text-fg"
            >
              <span>{display(t)}</span>
              {t.pending ? (
                <span
                  title="Tag will be created when this post is published"
                  className="text-fg-subtle"
                >
                  (new)
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => removeTag(t.slug)}
                aria-label={`Remove ${t.slug}`}
                className="text-fg-subtle hover:text-fg"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Slight delay so option clicks register.
            window.setTimeout(() => setOpen(false), 120)
          }}
          onKeyDown={handleKeyDown}
          placeholder={atMax ? `Max ${maxTags} tags` : 'Search tags…'}
          disabled={atMax}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle disabled:opacity-50"
        />

        {open && !atMax && (visibleOptions.length > 0 || showSuggestRow || loading || error) ? (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-bg shadow-md"
          >
            {loading && visibleOptions.length === 0 ? (
              <li className="px-3 py-2 text-xs text-fg-subtle">Loading…</li>
            ) : null}
            {error ? (
              <li className="px-3 py-2 text-xs text-red-700">{error}</li>
            ) : null}
            {visibleOptions.map((t, i) => (
              <li
                key={t.slug}
                role="option"
                aria-selected={i === clampedActiveIndex}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectAtIndex(i)
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`cursor-pointer px-3 py-1.5 text-sm ${
                  i === clampedActiveIndex ? 'bg-bg-hover text-fg' : 'text-fg'
                }`}
              >
                <span className="font-mono">{display(t)}</span>
                {t.name && t.name !== t.slug ? (
                  <span className="ml-2 text-xs text-fg-subtle">{t.name}</span>
                ) : null}
              </li>
            ))}
            {showSuggestRow && suggestedSlug ? (
              <li
                role="option"
                aria-selected={clampedActiveIndex === visibleOptions.length}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectAtIndex(visibleOptions.length)
                }}
                onMouseEnter={() => setActiveIndex(visibleOptions.length)}
                className={`cursor-pointer px-3 py-1.5 text-sm italic ${
                  clampedActiveIndex === visibleOptions.length
                    ? 'bg-bg-hover text-fg'
                    : 'text-fg-subtle'
                }`}
              >
                Suggest new tag &lsquo;{suggestedSlug}&rsquo;
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

export default TagPicker

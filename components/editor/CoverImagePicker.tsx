'use client'

import { useCallback, useRef, useState } from 'react'

export interface CoverImagePickerProps {
  value: string | null
  onChange: (url: string | null) => void
}

type Tab = 'url' | 'upload'

interface UrlValidation {
  status: 'idle' | 'checking' | 'ok' | 'warn' | 'error'
  message?: string
}

const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'You need to sign in to upload.',
  no_file: 'No file was provided.',
  invalid_bucket: 'Server misconfiguration: invalid bucket.',
  file_too_large: 'Image is larger than 2MB.',
  unsupported_type: 'Only JPEG, PNG, WebP, and GIF are supported.',
  dimensions_too_large: 'Image must be no larger than 6000 × 6000 pixels.',
  upload_failed: 'Upload failed. Try again.',
}

export function CoverImagePicker({ value, onChange }: CoverImagePickerProps) {
  const [tab, setTab] = useState<Tab>('url')
  const [urlField, setUrlField] = useState<string>(value ?? '')
  const [urlValidation, setUrlValidation] = useState<UrlValidation>({
    status: 'idle',
  })
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const commitUrl = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim()
      if (trimmed === '') {
        setUrlValidation({ status: 'idle' })
        onChange(null)
        return
      }
      let parsed: URL
      try {
        parsed = new URL(trimmed)
      } catch {
        setUrlValidation({ status: 'error', message: 'Not a valid URL.' })
        return
      }
      if (parsed.protocol !== 'https:') {
        setUrlValidation({
          status: 'error',
          message: 'URL must use https.',
        })
        return
      }

      setUrlValidation({ status: 'checking' })
      try {
        const res = await fetch(trimmed, { method: 'HEAD' })
        const ct = res.headers.get('content-type') ?? ''
        if (res.ok && ct.startsWith('image/')) {
          setUrlValidation({ status: 'ok' })
          onChange(trimmed)
        } else if (res.ok) {
          setUrlValidation({
            status: 'error',
            message: 'URL does not point to an image.',
          })
        } else {
          setUrlValidation({
            status: 'error',
            message: `Server returned HTTP ${res.status}.`,
          })
        }
      } catch {
        // CORS commonly blocks cross-origin HEAD. Accept the URL but warn —
        // the rendered <img> will surface a real failure when it loads.
        setUrlValidation({
          status: 'warn',
          message:
            "Couldn't verify the image (likely CORS). Saved anyway — preview will catch a broken link.",
        })
        onChange(trimmed)
      }
    },
    [onChange],
  )

  const handleFile = useCallback(
    async (file: File) => {
      setUploading(true)
      setUploadError(null)
      try {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/uploads?bucket=covers', {
          method: 'POST',
          body: form,
        })
        if (!res.ok) {
          const json = (await res
            .json()
            .catch(() => ({}))) as { error?: string }
          const code = json.error ?? 'upload_failed'
          setUploadError(
            UPLOAD_ERROR_MESSAGES[code] ?? `Upload failed (${code}).`,
          )
          return
        }
        const json = (await res.json()) as { url: string }
        onChange(json.url)
        setUrlField(json.url)
      } catch {
        setUploadError('Network error during upload.')
      } finally {
        setUploading(false)
      }
    },
    [onChange],
  )

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-fg">Cover image</label>

      {value ? (
        <div className="flex items-center gap-3">
          {/* Cover URLs are arbitrary remote hosts entered by the author —
              next/image would require allowlisting every domain in
              next.config. A plain <img> is fine for the small preview. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Cover preview"
            className="h-16 w-24 rounded-md border border-border object-cover"
          />
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setUrlField('')
              setUrlValidation({ status: 'idle' })
              setUploadError(null)
            }}
            className="text-xs text-fg-subtle hover:text-fg"
            aria-label="Remove cover image"
          >
            × Remove
          </button>
        </div>
      ) : null}

      <div className="flex gap-1 border-b border-border" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'url'}
          onClick={() => setTab('url')}
          className={`px-3 py-1.5 text-sm ${
            tab === 'url'
              ? 'border-b-2 border-fg text-fg'
              : 'text-fg-subtle hover:text-fg'
          }`}
        >
          URL
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'upload'}
          onClick={() => setTab('upload')}
          className={`px-3 py-1.5 text-sm ${
            tab === 'upload'
              ? 'border-b-2 border-fg text-fg'
              : 'text-fg-subtle hover:text-fg'
          }`}
        >
          Upload
        </button>
      </div>

      {tab === 'url' ? (
        <div className="space-y-1">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void commitUrl(urlField)
            }}
          >
            <input
              type="url"
              value={urlField}
              onChange={(e) => setUrlField(e.target.value)}
              onBlur={() => void commitUrl(urlField)}
              placeholder="https://example.com/cover.jpg"
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle"
            />
          </form>
          {urlValidation.status === 'checking' ? (
            <p className="text-xs text-fg-subtle">Checking…</p>
          ) : null}
          {urlValidation.status === 'ok' ? (
            <p className="text-xs text-green-700">Looks good.</p>
          ) : null}
          {urlValidation.status === 'warn' && urlValidation.message ? (
            <p className="text-xs text-yellow-700">{urlValidation.message}</p>
          ) : null}
          {urlValidation.status === 'error' && urlValidation.message ? (
            <p className="text-xs text-red-700" role="alert">
              {urlValidation.message}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              const file = e.dataTransfer.files?.[0]
              if (file) void handleFile(file)
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex h-28 cursor-pointer items-center justify-center rounded-md border border-dashed text-sm ${
              dragging
                ? 'border-fg bg-bg-hover text-fg'
                : 'border-border bg-bg-subtle text-fg-subtle'
            }`}
            role="button"
            tabIndex={0}
            aria-label="Drop an image or click to choose a file"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
          >
            {uploading
              ? 'Uploading…'
              : 'Drop an image, or click to choose a file'}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
              e.target.value = ''
            }}
          />
          {uploadError ? (
            <p className="text-xs text-red-700" role="alert">
              {uploadError}
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}

export default CoverImagePicker

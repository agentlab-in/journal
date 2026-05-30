'use client'

import { useEffect, useRef, useState } from 'react'

const CATEGORIES = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'off-topic', label: 'Off-topic' },
  { value: 'plagiarism', label: 'Plagiarism' },
  { value: 'other', label: 'Other' },
] as const

type Category = (typeof CATEGORIES)[number]['value']

export interface ReportModalProps {
  targetType: 'post' | 'comment' | 'user'
  targetId: string
  onClose: () => void
}

type ModalState = 'idle' | 'submitting' | 'success' | 'error'

export function ReportModal({ targetType, targetId, onClose }: ReportModalProps) {
  const [category, setCategory] = useState<Category>('spam')
  const [details, setDetails] = useState('')
  const [state, setState] = useState<ModalState>('idle')
  const [errorCode, setErrorCode] = useState<string>('')
  const [detailsError, setDetailsError] = useState('')
  const overlayRef = useRef<HTMLDivElement>(null)
  const isSubmitting = state === 'submitting'

  // Esc closes the modal (when not submitting)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isSubmitting, onClose])

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!isSubmitting && e.target === overlayRef.current) {
      onClose()
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Inline validation: if category=other and details is empty, require details
    if (category === 'other' && details.trim() === '') {
      setDetailsError('Please describe the issue.')
      return
    }
    setDetailsError('')

    // Build the reason string: "<category>: <details>" or just "<category>"
    const trimmed = details.trim()
    const reason = trimmed ? `${category}: ${trimmed}` : category

    setState('submitting')

    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: targetType, target_id: targetId, reason }),
      })

      if (res.ok) {
        setState('success')
        return
      }

      const data = (await res.json()) as { error?: string }
      setErrorCode(data.error ?? String(res.status))
      setState('error')
    } catch {
      setErrorCode('network_error')
      setState('error')
    }
  }

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={handleOverlayClick}
    >
      <div className="report-modal">
        <div className="report-modal__header">
          <h2 id="report-modal-title" className="report-modal__title">
            Report {targetType}
          </h2>
          <button
            type="button"
            className="report-modal__close"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close report dialog"
          >
            ×
          </button>
        </div>

        {state === 'success' ? (
          <p className="report-modal__success">Thanks. We&apos;ll review.</p>
        ) : (
          <form onSubmit={handleSubmit} className="report-modal__form">
            <div className="report-modal__field">
              <label htmlFor="report-category" className="report-modal__label">
                Reason
              </label>
              <select
                id="report-category"
                className="report-modal__select"
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                disabled={isSubmitting}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="report-modal__field">
              <label htmlFor="report-details" className="report-modal__label">
                Additional details{category === 'other' ? ' (required)' : ' (optional)'}
              </label>
              <textarea
                id="report-details"
                className="report-modal__textarea"
                rows={3}
                maxLength={800}
                placeholder={category === 'other' ? 'Describe the issue…' : 'Optional context…'}
                value={details}
                onChange={(e) => {
                  setDetails(e.target.value)
                  if (detailsError) setDetailsError('')
                }}
                disabled={isSubmitting}
                required={category === 'other'}
              />
              {detailsError && (
                <p className="report-modal__field-error">{detailsError}</p>
              )}
              <p className="report-modal__char-count">{details.length}/800</p>
            </div>

            {state === 'error' && (
              <p className="report-modal__error">
                Could not submit. {errorCode}
              </p>
            )}

            <div className="report-modal__actions">
              <button
                type="button"
                className="report-modal__cancel"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="report-modal__submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Submitting…' : 'Submit report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

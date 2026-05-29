'use client'

import { useId, useState, type FormEvent } from 'react'
import { waitlistEmailSchema } from '@/lib/waitlist'

type Status = 'idle' | 'submitting' | 'success' | 'error'

export default function WaitlistForm() {
  const inputId = useId()
  const statusId = useId()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string>('')

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status === 'submitting') return

    const parsed = waitlistEmailSchema.safeParse({ email: email.trim() })
    if (!parsed.success) {
      setStatus('error')
      setMessage(parsed.error.issues[0]?.message ?? 'Enter a valid email address.')
      return
    }

    setStatus('submitting')
    setMessage('')

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: parsed.data.email }),
      })

      if (response.ok) {
        setStatus('success')
        setMessage('Check your email to confirm your subscription.')
        setEmail('')
        return
      }

      const data = (await response.json().catch(() => null)) as { error?: string } | null
      setStatus('error')
      setMessage(data?.error ?? 'Something went wrong. Please try again later.')
    } catch {
      setStatus('error')
      setMessage('Network error. Please try again.')
    }
  }

  const isSuccess = status === 'success'

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Join the agentlab waitlist"
      className="mt-10 flex w-full max-w-md flex-col gap-3 sm:flex-row"
    >
      <label htmlFor={inputId} className="sr-only">
        Email address
      </label>
      <input
        id={inputId}
        type="email"
        name="email"
        autoComplete="email"
        required
        inputMode="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={isSuccess}
        aria-invalid={status === 'error'}
        aria-describedby={statusId}
        className="flex-1 rounded border border-border bg-bg-subtle px-3 py-2 font-mono text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={status === 'submitting' || isSuccess}
        className="rounded border border-border bg-fg px-4 py-2 font-mono text-sm font-medium text-bg transition-colors hover:bg-fg-subtle hover:text-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === 'submitting' ? 'joining…' : isSuccess ? 'joined' : 'join'}
      </button>

      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className={`mt-1 min-h-[1.25rem] basis-full font-mono text-xs sm:mt-0 sm:basis-full ${
          status === 'error' ? 'text-fg' : 'text-fg-subtle'
        }`}
      >
        {message}
      </p>
    </form>
  )
}

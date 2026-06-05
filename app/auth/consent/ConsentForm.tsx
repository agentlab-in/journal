'use client'

import { useState } from 'react'
import { recordConsent, declineConsent } from '@/lib/consent/server-actions'

export function ConsentForm() {
  const [age, setAge] = useState(false)
  const [terms, setTerms] = useState(false)
  const [contentPolicy, setContentPolicy] = useState(false)
  const [privacyPolicy, setPrivacyPolicy] = useState(false)

  const allChecked = age && terms && contentPolicy && privacyPolicy

  return (
    <form className="consent-form">
      <fieldset className="consent-fieldset">
        <legend className="consent-legend">Required confirmations</legend>

        <label className="consent-checkbox">
          <input
            type="checkbox"
            name="age"
            checked={age}
            onChange={(e) => setAge(e.target.checked)}
            required
          />
          <span>I confirm I am 18 years of age or older.</span>
        </label>

        <label className="consent-checkbox">
          <input
            type="checkbox"
            name="terms"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            required
          />
          <span>
            I have read and agree to the{' '}
            <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a>.
          </span>
        </label>

        <label className="consent-checkbox">
          <input
            type="checkbox"
            name="content_policy"
            checked={contentPolicy}
            onChange={(e) => setContentPolicy(e.target.checked)}
            required
          />
          <span>
            I have read and agree to the{' '}
            <a href="/policy" target="_blank" rel="noreferrer">Content Policy</a>.
          </span>
        </label>

        <label className="consent-checkbox">
          <input
            type="checkbox"
            name="privacy_policy"
            checked={privacyPolicy}
            onChange={(e) => setPrivacyPolicy(e.target.checked)}
            required
          />
          <span>
            I have read and agree to the{' '}
            <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
          </span>
        </label>
      </fieldset>

      <div className="consent-actions">
        <button
          type="submit"
          formAction={async (fd) => {
            // Controlled checkboxes don't serialize 'false' for unchecked
            // boxes by default; force-set so server-side validation sees
            // the actual UI state.
            fd.set('age', String(age))
            fd.set('terms', String(terms))
            fd.set('content_policy', String(contentPolicy))
            fd.set('privacy_policy', String(privacyPolicy))
            await recordConsent(fd)
          }}
          disabled={!allChecked}
          className="consent-submit"
        >
          Agree and continue
        </button>
        <button
          type="submit"
          formAction={async () => {
            await declineConsent()
          }}
          className="settings-cancel"
        >
          Decline
        </button>
      </div>
    </form>
  )
}

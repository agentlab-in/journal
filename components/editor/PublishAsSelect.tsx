'use client'

import { useId } from 'react'

export interface PublishAsSelectProps {
  currentUsername: string
}

/**
 * Stub for the publish-as identity picker. v1 ships single-user posts only;
 * Phase 11 will wire org/co-author options. Rendered as a disabled
 * <select> so the visual treatment matches what it will become.
 */
export function PublishAsSelect({ currentUsername }: PublishAsSelectProps) {
  const id = useId()
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        Publish as
      </label>
      <select
        id={id}
        disabled
        defaultValue={currentUsername}
        aria-readonly="true"
        className="w-full cursor-not-allowed rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm text-fg opacity-80"
      >
        <option value={currentUsername}>@{currentUsername}</option>
      </select>
    </div>
  )
}

export default PublishAsSelect

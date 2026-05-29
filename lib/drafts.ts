import { z } from 'zod'

export const DRAFT_NEW_KEY = 'agentlab.draft.new'

export function draftEditKey(postId: string): string {
  return `agentlab.draft.edit.${postId}`
}

export const DraftSchema = z.object({
  title: z.string(),
  summary: z.string(),
  type: z.enum(['post', 'playbook', 'dive']),
  body_md: z.string(),
  tags: z.array(z.string()),
  structured_sections: z.record(z.string(), z.string()).nullable(),
  cover_image_url: z.string().nullable(),
  savedAt: z.string(),
  schemaVersion: z.literal(1),
})

export type Draft = z.infer<typeof DraftSchema>
export type DraftType = Draft['type']

export function loadDraft(key: string): Draft | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(key)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    const result = DraftSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function saveDraft(
  key: string,
  payload: Omit<Draft, 'savedAt' | 'schemaVersion'>
): Draft {
  const draft: Draft = {
    ...payload,
    savedAt: new Date().toISOString(),
    schemaVersion: 1,
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, JSON.stringify(draft))
  }
  return draft
}

export function clearDraft(key: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(key)
}

export function hasNewerServerVersion(
  draft: Pick<Draft, 'savedAt'>,
  post: { updated_at: string }
): boolean {
  return post.updated_at > draft.savedAt
}

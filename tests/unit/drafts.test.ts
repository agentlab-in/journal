import { describe, it, expect, beforeEach } from 'vitest'
import {
  DRAFT_NEW_KEY,
  draftEditKey,
  loadDraft,
  saveDraft,
  clearDraft,
  hasNewerServerVersion,
  DraftSchema,
} from '@/lib/drafts'

beforeEach(() => {
  localStorage.clear()
})

describe('draft keys', () => {
  it('DRAFT_NEW_KEY is the canonical compose key', () => {
    expect(DRAFT_NEW_KEY).toBe('agentlab.draft.new')
  })

  it('draftEditKey builds an edit-scoped key from a post id', () => {
    expect(draftEditKey('abc-123')).toBe('agentlab.draft.edit.abc-123')
  })
})

describe('loadDraft()', () => {
  it('returns null when nothing is stored at the key', () => {
    expect(loadDraft(DRAFT_NEW_KEY)).toBeNull()
  })

  it('returns null when the stored JSON is syntactically invalid', () => {
    localStorage.setItem(DRAFT_NEW_KEY, '{not json')
    expect(loadDraft(DRAFT_NEW_KEY)).toBeNull()
  })

  it('returns null when schemaVersion is not 1', () => {
    localStorage.setItem(
      DRAFT_NEW_KEY,
      JSON.stringify({
        title: 't',
        summary: 's',
        type: 'post',
        body_md: 'b',
        tags: [],
        structured_sections: null,
        cover_image_url: null,
        savedAt: new Date().toISOString(),
        schemaVersion: 2,
      })
    )
    expect(loadDraft(DRAFT_NEW_KEY)).toBeNull()
  })

  it('returns null when a required field is missing', () => {
    localStorage.setItem(
      DRAFT_NEW_KEY,
      JSON.stringify({
        // title missing
        summary: 's',
        type: 'post',
        body_md: 'b',
        tags: [],
        structured_sections: null,
        cover_image_url: null,
        savedAt: new Date().toISOString(),
        schemaVersion: 1,
      })
    )
    expect(loadDraft(DRAFT_NEW_KEY)).toBeNull()
  })

  it('returns null when a field has the wrong type', () => {
    localStorage.setItem(
      DRAFT_NEW_KEY,
      JSON.stringify({
        title: 't',
        summary: 's',
        type: 'post',
        body_md: 'b',
        tags: 'not-an-array',
        structured_sections: null,
        cover_image_url: null,
        savedAt: new Date().toISOString(),
        schemaVersion: 1,
      })
    )
    expect(loadDraft(DRAFT_NEW_KEY)).toBeNull()
  })

  it('returns null when type is not one of the allowed literals', () => {
    localStorage.setItem(
      DRAFT_NEW_KEY,
      JSON.stringify({
        title: 't',
        summary: 's',
        type: 'essay',
        body_md: 'b',
        tags: [],
        structured_sections: null,
        cover_image_url: null,
        savedAt: new Date().toISOString(),
        schemaVersion: 1,
      })
    )
    expect(loadDraft(DRAFT_NEW_KEY)).toBeNull()
  })
})

describe('saveDraft()', () => {
  it('round-trips: save then load returns equivalent payload with savedAt populated', () => {
    const payload = {
      title: 'Hello',
      summary: 'A summary',
      type: 'playbook' as const,
      body_md: '# heading',
      tags: ['a', 'b'],
      structured_sections: { intro: 'hi' },
      cover_image_url: 'https://example.com/c.png',
    }
    const saved = saveDraft(DRAFT_NEW_KEY, payload)
    expect(saved.title).toBe(payload.title)
    expect(saved.summary).toBe(payload.summary)
    expect(saved.type).toBe(payload.type)
    expect(saved.body_md).toBe(payload.body_md)
    expect(saved.tags).toEqual(payload.tags)
    expect(saved.structured_sections).toEqual(payload.structured_sections)
    expect(saved.cover_image_url).toBe(payload.cover_image_url)
    expect(saved.schemaVersion).toBe(1)
    expect(typeof saved.savedAt).toBe('string')
    expect(() => new Date(saved.savedAt).toISOString()).not.toThrow()
    expect(new Date(saved.savedAt).toISOString()).toBe(saved.savedAt)

    const loaded = loadDraft(DRAFT_NEW_KEY)
    expect(loaded).toEqual(saved)
  })

  it('overwrites an existing draft at the same key', () => {
    saveDraft(DRAFT_NEW_KEY, {
      title: 'first',
      summary: '',
      type: 'post',
      body_md: '',
      tags: [],
      structured_sections: null,
      cover_image_url: null,
    })
    const second = saveDraft(DRAFT_NEW_KEY, {
      title: 'second',
      summary: '',
      type: 'post',
      body_md: '',
      tags: [],
      structured_sections: null,
      cover_image_url: null,
    })
    expect(loadDraft(DRAFT_NEW_KEY)?.title).toBe('second')
    expect(loadDraft(DRAFT_NEW_KEY)).toEqual(second)
  })

  it('persists savedAt as an ISO string, not a Date object', () => {
    const saved = saveDraft(DRAFT_NEW_KEY, {
      title: 't',
      summary: '',
      type: 'post',
      body_md: '',
      tags: [],
      structured_sections: null,
      cover_image_url: null,
    })
    const raw = localStorage.getItem(DRAFT_NEW_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string)
    expect(typeof parsed.savedAt).toBe('string')
    expect(parsed.savedAt).toBe(saved.savedAt)
  })
})

describe('clearDraft()', () => {
  it('removes the key from storage', () => {
    saveDraft(DRAFT_NEW_KEY, {
      title: 't',
      summary: '',
      type: 'post',
      body_md: '',
      tags: [],
      structured_sections: null,
      cover_image_url: null,
    })
    expect(localStorage.getItem(DRAFT_NEW_KEY)).not.toBeNull()
    clearDraft(DRAFT_NEW_KEY)
    expect(localStorage.getItem(DRAFT_NEW_KEY)).toBeNull()
    expect(loadDraft(DRAFT_NEW_KEY)).toBeNull()
  })

  it('is a no-op when the key does not exist', () => {
    expect(() => clearDraft(DRAFT_NEW_KEY)).not.toThrow()
  })
})

describe('hasNewerServerVersion()', () => {
  it('returns true when post.updated_at is strictly later than draft.savedAt', () => {
    const draftAt = '2026-01-01T00:00:00.000Z'
    const serverAt = '2026-01-02T00:00:00.000Z'
    expect(hasNewerServerVersion({ savedAt: draftAt }, { updated_at: serverAt })).toBe(true)
  })

  it('returns false when timestamps are equal', () => {
    const t = '2026-01-01T00:00:00.000Z'
    expect(hasNewerServerVersion({ savedAt: t }, { updated_at: t })).toBe(false)
  })

  it('returns false when the server version is older than the draft', () => {
    const draftAt = '2026-01-02T00:00:00.000Z'
    const serverAt = '2026-01-01T00:00:00.000Z'
    expect(hasNewerServerVersion({ savedAt: draftAt }, { updated_at: serverAt })).toBe(false)
  })
})

describe('DraftSchema', () => {
  it('is exported and parses a valid draft', () => {
    const parsed = DraftSchema.parse({
      title: 't',
      summary: '',
      type: 'dive',
      body_md: '',
      tags: [],
      structured_sections: null,
      cover_image_url: null,
      savedAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: 1,
    })
    expect(parsed.type).toBe('dive')
  })
})

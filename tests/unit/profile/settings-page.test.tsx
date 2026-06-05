import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports that trigger them
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentAdminClient: any = { from: vi.fn() }

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => currentAdminClient),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/components/profile/ProfileSettingsForm', () => ({
  ProfileSettingsForm: (props: {
    username: string
    displayName: string
    bio: string | null
    avatarUrl: string | null
  }) =>
    React.createElement('div', {
      'data-testid': 'profile-settings-form',
      'data-username': props.username,
      'data-display-name': props.displayName,
      'data-bio': props.bio ?? '',
      'data-avatar-url': props.avatarUrl ?? '',
    }),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { ProfileSettingsForm } from '@/components/profile/ProfileSettingsForm'
import ProfileSettingsPage from '@/app/settings/profile/page'

const USER_ID = '11111111-1111-4111-8111-111111111111'

function makeAdminClient(row: {
  username: string
  display_name: string
  bio: string | null
  avatar_url: string | null
} | null) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'consents') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn(() =>
                    Promise.resolve({ data: null, error: null }),
                  ),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'org_members') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        }
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve(
                row
                  ? { data: row, error: null }
                  : { data: null, error: { message: 'not found' } },
              ),
            ),
          })),
        })),
      }
    }),
  }
}

function findByComponentType(
  tree: React.ReactNode,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  target: (...args: any[]) => any,
): React.ReactElement | null {
  if (tree == null || tree === false || tree === true) return null
  if (Array.isArray(tree)) {
    for (const node of tree) {
      const found = findByComponentType(node, target)
      if (found) return found
    }
    return null
  }
  if (!React.isValidElement(tree)) return null
  if (tree.type === target) return tree
  const props = tree.props as Record<string, unknown>
  const children = props.children as React.ReactNode
  return findByComponentType(children, target)
}

describe('ProfileSettingsPage', () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset()
    vi.mocked(redirect).mockClear()
    vi.mocked(notFound).mockClear()
    currentAdminClient = makeAdminClient(null)
  })

  it('redirects to /auth/signin when no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    await expect(ProfileSettingsPage()).rejects.toThrow(
      'NEXT_REDIRECT:/auth/signin',
    )
    expect(redirect).toHaveBeenCalledWith('/auth/signin')
  })

  it('renders ProfileSettingsForm with the loaded row when signed in', async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: USER_ID, name: 'Alice', email: 'a@example.com' },
      expires: '2099-12-31T23:59:59.000Z',
    })
    currentAdminClient = makeAdminClient({
      username: 'alice',
      display_name: 'Alice',
      bio: 'About me.',
      avatar_url: 'https://cdn.example.com/u/a.webp',
    })

    const tree = await ProfileSettingsPage()
    const form = findByComponentType(tree, ProfileSettingsForm)
    expect(form).not.toBeNull()
    const props = form!.props as {
      username: string
      displayName: string
      bio: string | null
      avatarUrl: string | null
    }
    expect(props.username).toBe('alice')
    expect(props.displayName).toBe('Alice')
    expect(props.bio).toBe('About me.')
    expect(props.avatarUrl).toBe('https://cdn.example.com/u/a.webp')
  })

  it('calls notFound() when the public.users row is missing', async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: USER_ID, name: 'Ghost', email: 'g@example.com' },
      expires: '2099-12-31T23:59:59.000Z',
    })
    currentAdminClient = makeAdminClient(null)

    await expect(ProfileSettingsPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('forwards null bio / avatar_url to the form', async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: USER_ID, name: 'Bob', email: 'b@example.com' },
      expires: '2099-12-31T23:59:59.000Z',
    })
    currentAdminClient = makeAdminClient({
      username: 'bob',
      display_name: 'Bob',
      bio: null,
      avatar_url: null,
    })

    const tree = await ProfileSettingsPage()
    const form = findByComponentType(tree, ProfileSettingsForm)
    const props = form!.props as { bio: string | null; avatarUrl: string | null }
    expect(props.bio).toBeNull()
    expect(props.avatarUrl).toBeNull()
  })
})

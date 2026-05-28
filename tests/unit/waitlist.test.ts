import { describe, it, expect } from 'vitest'
import { waitlistEmailSchema } from '@/lib/waitlist'

describe('waitlistEmailSchema', () => {
  it('accepts a well-formed email', () => {
    const result = waitlistEmailSchema.safeParse({ email: 'harshit@agentlab.in' })
    expect(result.success).toBe(true)
  })

  it('rejects an empty string', () => {
    const result = waitlistEmailSchema.safeParse({ email: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a missing @', () => {
    const result = waitlistEmailSchema.safeParse({ email: 'not-an-email' })
    expect(result.success).toBe(false)
  })

  it('rejects emails longer than RFC 5321 max (254 chars)', () => {
    const local = 'a'.repeat(250)
    const result = waitlistEmailSchema.safeParse({ email: `${local}@b.co` })
    expect(result.success).toBe(false)
  })

  it('rejects a missing email field', () => {
    const result = waitlistEmailSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

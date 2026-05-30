import { describe, it, expect } from 'vitest'
import { isAllowedOrigin } from '@/lib/security/origin-check'

describe('isAllowedOrigin', () => {
  describe('allowed origins', () => {
    it('accepts https://agentlab.in', () => {
      expect(isAllowedOrigin('https://agentlab.in')).toBe(true)
    })

    it('accepts https://dev.agentlab.in', () => {
      expect(isAllowedOrigin('https://dev.agentlab.in')).toBe(true)
    })

    it('accepts http://localhost:3010', () => {
      expect(isAllowedOrigin('http://localhost:3010')).toBe(true)
    })

    it('tolerates a single trailing slash', () => {
      expect(isAllowedOrigin('https://agentlab.in/')).toBe(true)
      expect(isAllowedOrigin('http://localhost:3010/')).toBe(true)
    })
  })

  describe('rejected origins', () => {
    it('rejects null', () => {
      expect(isAllowedOrigin(null)).toBe(false)
    })

    it('rejects empty string', () => {
      expect(isAllowedOrigin('')).toBe(false)
    })

    it('rejects look-alike subdomains', () => {
      expect(isAllowedOrigin('https://evil.agentlab.in')).toBe(false)
      expect(isAllowedOrigin('https://agentlab.in.evil.com')).toBe(false)
    })

    it('rejects mismatched scheme', () => {
      expect(isAllowedOrigin('http://agentlab.in')).toBe(false)
      expect(isAllowedOrigin('https://localhost:3010')).toBe(false)
    })

    it('rejects double-dot variants', () => {
      expect(isAllowedOrigin('https://agentlab..in')).toBe(false)
    })

    it('rejects the IP literal for localhost', () => {
      expect(isAllowedOrigin('http://127.0.0.1:3010')).toBe(false)
    })

    it('rejects embedded credentials', () => {
      expect(isAllowedOrigin('https://attacker@agentlab.in')).toBe(false)
    })

    it('rejects path-bearing origins', () => {
      expect(isAllowedOrigin('https://agentlab.in/path')).toBe(false)
    })

    it('rejects wrong port on localhost', () => {
      expect(isAllowedOrigin('http://localhost:3000')).toBe(false)
    })
  })
})

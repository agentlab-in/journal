import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import robots from '@/app/robots'

const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV

describe('app/robots', () => {
  beforeEach(() => {
    process.env.VERCEL_ENV = 'production'
  })

  afterEach(() => {
    if (ORIGINAL_VERCEL_ENV === undefined) {
      delete process.env.VERCEL_ENV
    } else {
      process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV
    }
  })

  describe('production (VERCEL_ENV=production)', () => {
    it('exposes a single rule allowing / for user-agent *', () => {
      const r = robots()
      expect(Array.isArray(r.rules)).toBe(false)
      const rules = r.rules as { userAgent: string; allow: string; disallow: string[] }
      expect(rules.userAgent).toBe('*')
      expect(rules.allow).toBe('/')
    })

    it('collapses the Disallow list to just /api/ (H8 — admin/write/settings already protected at handler)', () => {
      const r = robots()
      const rules = r.rules as { disallow: string[] }
      expect(rules.disallow).toEqual(['/api/'])
    })

    it('does NOT advertise /admin, /write, /settings, or auth surfaces', () => {
      const r = robots()
      const rules = r.rules as { disallow: string[] }
      for (const path of ['/admin', '/write', '/settings', '/auth/blocked', '/auth/signin']) {
        expect(rules.disallow).not.toContain(path)
      }
    })

    it('points at an absolute sitemap URL ending in /sitemap.xml', () => {
      const r = robots()
      const sitemap = r.sitemap as string
      expect(sitemap.startsWith('https://')).toBe(true)
      expect(sitemap.endsWith('/sitemap.xml')).toBe(true)
    })

    it('sets host to the canonical site origin', () => {
      const r = robots()
      expect(r.host).toBe('https://journal.agentlab.in')
    })
  })

  describe('non-production deployments (L4)', () => {
    it('disallows everything when VERCEL_ENV is "preview"', () => {
      process.env.VERCEL_ENV = 'preview'
      const r = robots()
      const rules = r.rules as { userAgent: string; disallow: string }
      expect(rules.userAgent).toBe('*')
      expect(rules.disallow).toBe('/')
    })

    it('disallows everything when VERCEL_ENV is unset', () => {
      delete process.env.VERCEL_ENV
      const r = robots()
      const rules = r.rules as { userAgent: string; disallow: string }
      expect(rules.disallow).toBe('/')
    })

    it('omits the sitemap on non-production so previews stay out of search', () => {
      process.env.VERCEL_ENV = 'preview'
      const r = robots()
      expect(r.sitemap).toBeUndefined()
    })
  })
})

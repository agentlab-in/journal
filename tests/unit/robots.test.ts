import { describe, it, expect } from 'vitest'
import robots from '@/app/robots'

describe('app/robots', () => {
  it('exposes a single rule allowing / for user-agent *', () => {
    const r = robots()
    expect(Array.isArray(r.rules)).toBe(false)
    const rules = r.rules as { userAgent: string; allow: string; disallow: string[] }
    expect(rules.userAgent).toBe('*')
    expect(rules.allow).toBe('/')
  })

  it('disallows admin, write, settings, api, and auth surfaces', () => {
    const r = robots()
    const rules = r.rules as { disallow: string[] }
    for (const path of [
      '/admin',
      '/write',
      '/settings',
      '/api',
      '/auth/blocked',
      '/auth/signin',
    ]) {
      expect(rules.disallow).toContain(path)
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
    expect(r.host).toBe('https://agentlab.in')
  })
})

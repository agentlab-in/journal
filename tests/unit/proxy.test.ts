/**
 * Unit tests for proxy.ts — the H7 CSRF backstop.
 *
 * Real NextRequest from next/server is used so the Origin check runs
 * against actual web-fetch headers; only isAllowedOrigin is mocked so
 * we can exercise allow/deny without binding to the static allowlist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const isAllowedOrigin = vi.fn<(origin: string | null) => boolean>()

vi.mock('@/lib/security/origin-check', () => ({
  isAllowedOrigin: (origin: string | null) => isAllowedOrigin(origin),
}))

import { proxy } from '@/proxy'

function makeRequest(
  pathname: string,
  init: { method?: string; origin?: string | null } = {},
) {
  const headers = new Headers()
  if (init.origin !== null && init.origin !== undefined) {
    headers.set('origin', init.origin)
  }
  return new NextRequest(new URL(pathname, 'http://localhost:3010'), {
    method: init.method ?? 'GET',
    headers,
  })
}

describe('proxy()', () => {
  beforeEach(() => {
    isAllowedOrigin.mockReset()
  })

  describe('NextAuth bypass', () => {
    it('passes /api/auth/* mutating requests through without checking Origin', async () => {
      const res = proxy(makeRequest('/api/auth/signin', { method: 'POST' }))
      expect(res.status).toBe(200)
      expect(isAllowedOrigin).not.toHaveBeenCalled()
    })

    it('passes /api/auth/* GETs through without checking Origin', async () => {
      const res = proxy(makeRequest('/api/auth/session', { method: 'GET' }))
      expect(res.status).toBe(200)
      expect(isAllowedOrigin).not.toHaveBeenCalled()
    })
  })

  describe('non-mutating methods', () => {
    it('passes GET requests through without checking Origin', () => {
      const res = proxy(makeRequest('/api/posts', { method: 'GET' }))
      expect(res.status).toBe(200)
      expect(isAllowedOrigin).not.toHaveBeenCalled()
    })

    it('passes HEAD requests through without checking Origin', () => {
      const res = proxy(makeRequest('/api/posts', { method: 'HEAD' }))
      expect(res.status).toBe(200)
      expect(isAllowedOrigin).not.toHaveBeenCalled()
    })

    it('passes OPTIONS requests through without checking Origin', () => {
      const res = proxy(makeRequest('/api/posts', { method: 'OPTIONS' }))
      expect(res.status).toBe(200)
      expect(isAllowedOrigin).not.toHaveBeenCalled()
    })
  })

  describe('mutating /api/* requests with disallowed Origin', () => {
    it('blocks POST with no Origin header with 403 { error: "forbidden_origin" }', async () => {
      isAllowedOrigin.mockReturnValue(false)
      const res = proxy(makeRequest('/api/posts', { method: 'POST', origin: null }))
      expect(res.status).toBe(403)
      expect(res.headers.get('content-type')).toContain('application/json')
      expect(await res.json()).toEqual({ error: 'forbidden_origin' })
      expect(isAllowedOrigin).toHaveBeenCalledWith(null)
    })

    it('blocks PUT with a non-allowlisted Origin', async () => {
      isAllowedOrigin.mockReturnValue(false)
      const res = proxy(
        makeRequest('/api/posts/abc', { method: 'PUT', origin: 'https://evil.example' }),
      )
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'forbidden_origin' })
    })

    it('blocks PATCH with a non-allowlisted Origin', async () => {
      isAllowedOrigin.mockReturnValue(false)
      const res = proxy(
        makeRequest('/api/posts/abc', { method: 'PATCH', origin: 'https://evil.example' }),
      )
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'forbidden_origin' })
    })

    it('blocks DELETE with a non-allowlisted Origin', async () => {
      isAllowedOrigin.mockReturnValue(false)
      const res = proxy(
        makeRequest('/api/posts/abc', { method: 'DELETE', origin: 'https://evil.example' }),
      )
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'forbidden_origin' })
    })

    it('returns the same JSON shape as guardMutatingRequest in lib/route-guard.ts', async () => {
      isAllowedOrigin.mockReturnValue(false)
      const res = proxy(makeRequest('/api/posts', { method: 'POST' }))
      expect(await res.json()).toEqual({ error: 'forbidden_origin' })
    })
  })

  describe('mutating /api/* requests with allowed Origin', () => {
    it('passes POST through when isAllowedOrigin returns true', () => {
      isAllowedOrigin.mockReturnValue(true)
      const res = proxy(
        makeRequest('/api/posts', { method: 'POST', origin: 'https://agentlab.in' }),
      )
      expect(res.status).toBe(200)
      expect(isAllowedOrigin).toHaveBeenCalledWith('https://agentlab.in')
    })

    it('passes DELETE through when isAllowedOrigin returns true', () => {
      isAllowedOrigin.mockReturnValue(true)
      const res = proxy(
        makeRequest('/api/posts/abc', { method: 'DELETE', origin: 'https://agentlab.in' }),
      )
      expect(res.status).toBe(200)
    })
  })

  describe('matcher posture', () => {
    it('declares matcher: ["/api/:path*"] so the proxy only runs on /api/*', async () => {
      const { config } = await import('@/proxy')
      expect(config.matcher).toEqual(['/api/:path*'])
    })
  })
})

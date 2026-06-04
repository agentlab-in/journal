// H7 — Backstop CSRF gate.
//
// Per-handler `guardMutatingRequest` calls remain in place, but this file
// closes the gap where a future API handler ships without remembering to
// invoke the guard. We re-use the same origin allowlist so behaviour stays
// consistent with the in-handler check.
//
// File is named `proxy.ts` because Next.js 16 deprecated and renamed the
// `middleware` file convention to `proxy`. See
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isAllowedOrigin } from '@/lib/security/origin-check'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function proxy(request: NextRequest) {
  // NextAuth manages its own CSRF tokens — don't double-gate it or
  // sign-in flows break.
  if (request.nextUrl.pathname.startsWith('/api/auth/')) {
    return NextResponse.next()
  }
  if (!MUTATING_METHODS.has(request.method)) {
    return NextResponse.next()
  }
  if (!isAllowedOrigin(request.headers.get('origin'))) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}

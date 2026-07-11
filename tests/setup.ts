import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'
import { __resetForTests as resetRateLimit } from '@/lib/rate-limit'

// Node >= 22 ships a native, experimental `localStorage` global that is
// disabled unless `--localstorage-file` is passed, and it shadows jsdom's
// `window.localStorage`. On CI (older Node) jsdom provides a working Storage,
// so the guard below is a no-op there. On Node 26 locally the global is
// unusable (accessing it throws), which broke drafts / draft-manager /
// theme-toggle / view-beacon. Install a minimal in-memory Storage only when
// the current one is unusable, so `pnpm test` is deterministic across Node
// versions without depending on how any single machine exposes Web Storage.
function makeMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value))
    },
  } as Storage
}

function storageUsable(candidate: unknown): boolean {
  try {
    if (!candidate) return false
    const s = candidate as Storage
    s.setItem('__probe__', '1')
    s.removeItem('__probe__')
    return true
  } catch {
    return false
  }
}

function installStorage(name: 'localStorage' | 'sessionStorage'): void {
  const shim = makeMemoryStorage()
  for (const target of [globalThis, typeof window !== 'undefined' ? window : undefined]) {
    if (!target) continue
    try {
      Object.defineProperty(target, name, {
        value: shim,
        configurable: true,
        writable: true,
      })
    } catch {
      try {
        ;(target as Record<string, unknown>)[name] = shim
      } catch {
        // Some runtimes expose Web Storage as a non-configurable accessor we
        // cannot replace. Nothing more to do; the guard already confirmed it
        // is unusable, so those specific tests still fail loudly rather than
        // silently pass against a broken Storage.
      }
    }
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (!storageUsable((globalThis as Record<string, unknown>)[name])) {
    installStorage(name)
  }
}

// Phase 14 — guardMutatingRequest hits the in-memory rate-limit fallback
// in tests (Upstash env is unset). Without a per-test reset, buckets carry
// across tests inside the same file and exhaust early (publish=10/hour,
// report=10/hour). Reset before every test so each test starts fresh.
beforeEach(() => {
  resetRateLimit()
})

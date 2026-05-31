import { env } from './env'

/**
 * Canonical origin used by sitemap/robots/OG/RSS for absolute URLs.
 * Reads NEXT_PUBLIC_SITE_URL with a production-host fallback so previews
 * and CI builds resolve sensibly without env wiring.
 */
export const SITE_URL = env.NEXT_PUBLIC_SITE_URL ?? 'https://agentlab.in'

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString()
}

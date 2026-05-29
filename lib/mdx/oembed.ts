/**
 * Tiny server-only oEmbed helper used by the `<Embed>` MDX component.
 * Server-only by convention — the `Embed` consumer is an async React
 * Server Component, so this never lands in the client bundle.
 *
 * Provider whitelist:
 *   - YouTube (`youtube.com`, `youtu.be`) → resolve to the canonical watch
 *     URL. Phase 3 ships a link-only fallback to keep the bundle/runtime
 *     small; an iframe embed can land in Phase 4.
 *   - GitHub Gist (`gist.github.com`) → fetch the gist's oEmbed JSON
 *     (cached 5 min) and return a marketing-blockquote link with title.
 *
 * Everything else returns `{ ok: false }` so the caller renders the
 * styled blockquote fallback. Twitter/X oEmbed is no longer free, so it
 * always falls back even though `twitter.com` is mentioned in the spec.
 *
 * The caller is responsible for guarding `dangerouslySetInnerHTML` with
 * `ok`. We never return embed HTML for non-whitelisted providers, which
 * keeps the XSS surface bounded to two known endpoints.
 */

export type OEmbedResult = {
  ok: boolean
  html: string
}

const FAILURE: OEmbedResult = { ok: false, html: '' }

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'youtu.be'])
const GIST_HOSTS = new Set(['gist.github.com'])

function safeHost(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return null
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function youtube(url: string): Promise<OEmbedResult> {
  // Phase 3: don't fetch network — return a captioned link.
  return {
    ok: true,
    html: `<a href="${escapeHtml(url)}" rel="noopener noreferrer" target="_blank">Watch on YouTube</a>`,
  }
}

async function gist(url: string): Promise<OEmbedResult> {
  // Cached server fetch. If it fails, return failure → caller falls back.
  try {
    const res = await fetch(`https://github.com/api/oembed?format=json&url=${encodeURIComponent(url)}`, {
      // next-cache: 5 min. Safe even if running outside Next.
      next: { revalidate: 300 },
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return FAILURE
    const data = (await res.json()) as { title?: string }
    const title = typeof data.title === 'string' ? data.title : url
    return {
      ok: true,
      html: `<a href="${escapeHtml(url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(title)}</a>`,
    }
  } catch {
    return FAILURE
  }
}

export async function fetchOEmbed(url: string): Promise<OEmbedResult> {
  const host = safeHost(url)
  if (!host) return FAILURE
  if (YT_HOSTS.has(host)) return youtube(url)
  if (GIST_HOSTS.has(host)) return gist(url)
  return FAILURE
}

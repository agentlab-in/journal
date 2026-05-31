import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NextResponse } from 'next/server'
import { getCachedPost } from '@/lib/posts/lookup'
import { isPostType } from '@/lib/posts/url'
import { absoluteUrl } from '@/lib/site-url'

// readFile from node:fs/promises requires the Node runtime.
export const runtime = 'nodejs'

export const alt = 'agentlab.in post share image'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Module-scope cache: the TTF is ~260 KB and identical across every
// request. Reading it once per Lambda cold start (and reusing the
// resolved Buffer thereafter) shaves ~5-10ms off warm OG renders.
let fontDataPromise: Promise<Buffer> | null = null
function loadFont(): Promise<Buffer> {
  if (!fontDataPromise) {
    fontDataPromise = readFile(
      join(process.cwd(), 'assets/JetBrainsMono-Regular.ttf'),
    )
  }
  return fontDataPromise
}

// Titles wider than this overflow the 1200×630 canvas at 64px in
// JetBrains Mono — truncating with an ellipsis is cheaper than
// measuring text and beats Satori silently clipping the glyph.
const TITLE_MAX_CHARS = 80

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…'
}

// Redirect to the static fallback so a social card never serves a
// broken image when the post is missing, the type segment is junk,
// or supabase env is unset (the lookup throws → caught here).
function fallback() {
  return NextResponse.redirect(absoluteUrl('/og.png'), 302)
}

interface RenderData {
  title: string
  username: string
  fontData: Buffer
}

async function loadRenderData(params: {
  username: string
  type: string
  slug: string
}): Promise<RenderData | null> {
  if (!isPostType(params.type)) return null
  const post = await getCachedPost(params)
  if (!post) return null
  return {
    title: truncate(post.title, TITLE_MAX_CHARS),
    username: post.author.username,
    fontData: await loadFont(),
  }
}

export default async function Image({
  params,
}: {
  params: Promise<{ username: string; type: string; slug: string }>
}) {
  const resolved = await params

  let data: RenderData | null
  try {
    data = await loadRenderData(resolved)
  } catch {
    return fallback()
  }
  if (!data) return fallback()

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 80,
          fontFamily: 'JetBrains Mono',
          background: 'linear-gradient(135deg, #000 0%, #0a0a0a 100%)',
          color: '#fff',
        }}
      >
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
          }}
        >
          {data.title}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            color: '#888',
            fontSize: 28,
          }}
        >
          <span>@{data.username}</span>
          <span>agentlab.in</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: 'JetBrains Mono',
          data: data.fontData,
          style: 'normal',
          weight: 400,
        },
      ],
    },
  )
}

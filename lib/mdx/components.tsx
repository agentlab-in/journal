// MDX allowlist + `<pre>` override that swaps in MermaidBlock for
// ```mermaid fenced blocks. All keys are lowercase: the compile pipeline
// converts MDX-JSX nodes to HAST elements with lowercase tag names so
// they survive rehype-sanitize and map cleanly onto these components.

import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { fetchOEmbed } from './oembed'
import { MermaidBlock } from './MermaidBlock'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { MdxFailedFallback } from '@/components/error/MdxFailedFallback'

// ---------- Callout -----------------------------------------------------

export type CalloutType = 'info' | 'tip' | 'warning' | 'danger'

// Phase 13 dark-mode audit: each semantic palette needs a dark-friendly
// counterpart so the surface still reads as info/tip/warning/danger
// without burning eyes. The light palette uses the 300/50/900 shades that
// previously shipped; dark layers a darker tinted bg + light text + a
// stronger border accent over the same hue so the semantic meaning
// survives the theme flip. `dark:` is wired to data-theme="dark" via the
// @custom-variant declaration in app/globals.css.
const CALLOUT_STYLES: Record<CalloutType, string> = {
  info: 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-100',
  tip: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100',
  warning: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100',
  danger: 'border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100',
}

export interface CalloutProps {
  type?: CalloutType
  children?: ReactNode
}

export function Callout({ type = 'info', children }: CalloutProps) {
  const palette = CALLOUT_STYLES[type] ?? CALLOUT_STYLES.info
  return (
    <div
      role="note"
      data-callout-type={type}
      className={`my-4 rounded-md border-l-4 px-4 py-3 ${palette}`}
    >
      {children}
    </div>
  )
}

// ---------- Embed (server component) ------------------------------------

export interface EmbedProps {
  url: string
  provider?: string
}

function Fallback({ url }: { url: string }) {
  // Phase 13: theme tokens for surface/border/text so the fallback reads
  // in both themes. The link keeps the blue accent (it's still a link)
  // with a lighter shade in dark mode for contrast against bg-subtle.
  return (
    <blockquote className="my-4 border-l-4 border-border bg-bg-subtle px-4 py-3 italic text-fg-subtle">
      <a
        href={url}
        rel="noopener noreferrer"
        target="_blank"
        className="text-blue-700 underline dark:text-blue-300"
      >
        {url}
      </a>
    </blockquote>
  )
}

export async function Embed({ url, provider }: EmbedProps) {
  if (!url || typeof url !== 'string') return <Fallback url={url ?? ''} />
  // Twitter/X has no free oEmbed — always fall back, regardless of provider hint.
  let host = ''
  try {
    host = new URL(url).host.toLowerCase()
  } catch {
    return <Fallback url={url} />
  }
  // Exact host or true subdomain only — a bare `endsWith` would match
  // `aaa-twitter.com`, letting an attacker-controlled lookalike host
  // route through the Twitter fallback.
  const isTwitter = host === 'twitter.com' || host.endsWith('.twitter.com')
  const isX = host === 'x.com' || host.endsWith('.x.com')
  if (isTwitter || isX) {
    return <Fallback url={url} />
  }
  const result = await fetchOEmbed(url)
  if (!result.ok) return <Fallback url={url} />
  return (
    <div
      className="my-4"
      data-embed-provider={provider ?? host}
      dangerouslySetInnerHTML={{ __html: result.html }}
    />
  )
}

// ---------- Figure ------------------------------------------------------

export interface FigureProps {
  src: string
  alt?: string
  caption?: string
}

export function Figure({ src, alt = '', caption }: FigureProps) {
  // Phase 3 uses a plain <img>; Phase 4 will switch to next/image once we
  // lock the remote-host allowlist via next.config.ts. The disable below
  // is intentional — `@next/next/no-img-element` is the only complaint.
  return (
    <figure className="my-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="mx-auto h-auto max-w-full rounded-md"
        loading="lazy"
      />
      {caption ? (
        <figcaption className="mt-2 text-center text-sm text-fg-subtle">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  )
}

// ---------- Aside -------------------------------------------------------

export interface AsideProps {
  children?: ReactNode
}

export function Aside({ children }: AsideProps) {
  // Phase 13: was hardcoded neutral-200/50/800; theme tokens render the
  // aside as a soft surface in both themes (bg-subtle is light grey in
  // light, near-black in dark).
  return (
    <aside className="my-6 border-l-4 border-border bg-bg-subtle px-4 py-3 text-fg">
      {children}
    </aside>
  )
}

// ---------- Detail (<details><summary>) ---------------------------------

export interface DetailProps {
  summary?: string
  children?: ReactNode
}

export function Detail({ summary = 'Details', children }: DetailProps) {
  // Phase 13: bg-white was unreadable in dark mode. Theme tokens render
  // the disclosure as a bordered card on the page background.
  return (
    <details className="my-4 rounded-md border border-border bg-bg p-3">
      <summary className="cursor-pointer font-medium text-fg">
        {summary}
      </summary>
      <div className="mt-2 text-fg-subtle">{children}</div>
    </details>
  )
}

// ---------- <pre> override → MermaidBlock for language-mermaid ---------

type PreProps = {
  children?: ReactNode
} & React.HTMLAttributes<HTMLPreElement>

interface CodeChildProps {
  className?: string
  children?: ReactNode
}

function extractCodeFromPre(children: ReactNode): CodeChildProps | null {
  if (isValidElement(children)) {
    const el = children as ReactElement<CodeChildProps>
    if (
      typeof el.type === 'string' &&
      el.type === 'code' &&
      el.props &&
      typeof el.props === 'object'
    ) {
      return el.props
    }
  }
  return null
}

function nodeToString(node: ReactNode): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeToString).join('')
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>
    return nodeToString(el.props?.children)
  }
  return ''
}

function PreWithMermaid({ children, ...rest }: PreProps) {
  const codeProps = extractCodeFromPre(children)
  const cls = codeProps?.className ?? ''
  if (cls.split(/\s+/).includes('language-mermaid')) {
    const code = nodeToString(codeProps?.children)
    // MermaidBlock has internal try/catch around mermaid.render, but a
    // sync error (failed dynamic import of mermaid, state init crash)
    // would still bubble. Wrap so a broken diagram can never take down
    // the surrounding MDX render.
    return (
      <ErrorBoundary
        resetKey={code}
        fallback={<MdxFailedFallback context="diagram" />}
      >
        <MermaidBlock code={code} />
      </ErrorBoundary>
    )
  }
  // Phase 13: previously hardcoded bg-neutral-950 / text-neutral-100 which
  // looked fine on a dark page but inverted-light on a light page. Theme
  // tokens defer to globals.css `.post-body pre` (bg-subtle + border) when
  // mounted under .post-body and stay legible elsewhere (e.g. editor
  // preview pane that lacks the .post-body wrapper).
  return (
    <pre
      {...rest}
      className={`overflow-x-auto rounded-md border border-border bg-bg-subtle p-4 text-sm text-fg ${
        rest.className ?? ''
      }`.trim()}
    >
      {children}
    </pre>
  )
}

// ---------- The allowlist map exported to <MDXRemote> -------------------

export const mdxComponents = {
  callout: Callout,
  embed: Embed,
  figure: Figure,
  aside: Aside,
  detail: Detail,
  pre: PreWithMermaid,
} as const

export { MermaidBlock }

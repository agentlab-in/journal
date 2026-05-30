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

const CALLOUT_STYLES: Record<CalloutType, string> = {
  info: 'border-blue-300 bg-blue-50 text-blue-900',
  tip: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  danger: 'border-red-300 bg-red-50 text-red-900',
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
  return (
    <blockquote className="my-4 border-l-4 border-neutral-300 bg-neutral-50 px-4 py-3 italic text-neutral-700">
      <a
        href={url}
        rel="noopener noreferrer"
        target="_blank"
        className="text-blue-700 underline"
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
  if (host.endsWith('twitter.com') || host.endsWith('x.com')) {
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
        <figcaption className="mt-2 text-center text-sm text-neutral-600">
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
  return (
    <aside className="my-6 border-l-4 border-neutral-200 bg-neutral-50 px-4 py-3 text-neutral-800">
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
  return (
    <details className="my-4 rounded-md border border-neutral-200 bg-white p-3">
      <summary className="cursor-pointer font-medium text-neutral-900">
        {summary}
      </summary>
      <div className="mt-2 text-neutral-700">{children}</div>
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
  return (
    <pre
      {...rest}
      className={`overflow-x-auto rounded-md bg-neutral-950 p-4 text-sm text-neutral-100 ${
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

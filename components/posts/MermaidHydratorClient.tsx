'use client'

import dynamic from 'next/dynamic'
import type { MermaidHydratorProps } from './MermaidHydrator'

// Lazy-load the mermaid hydrator with `ssr: false` so its chunk (plus the
// `mermaid` library it dynamic-imports on mount) is omitted from the
// first-load manifest of pages that don't render it. Next.js disallows
// `ssr: false` inside `dynamic()` when called from a Server Component, so
// this thin "use client" wrapper exists purely to host the call — the post
// page (a Server Component) imports it as a regular client component.
//
// Defined at module scope: putting `dynamic()` inside the render function
// would create a new component identity per render, defeating React.memo
// and chunk caching.
const MermaidHydratorDynamic = dynamic(
  () =>
    import('./MermaidHydrator').then((m) => ({ default: m.MermaidHydrator })),
  { ssr: false },
)

export function MermaidHydratorClient(props: MermaidHydratorProps) {
  return <MermaidHydratorDynamic {...props} />
}

// Tracks the theme mermaid was last initialised with. Phase 13 dark-mode
// audit: if the user toggles the page theme after a diagram has rendered,
// we re-initialise mermaid with the new value so subsequent renders match
// the surrounding page. The existing SVG isn't re-themed in place — the
// MermaidBlock effect re-runs and `mermaid.render()` produces a fresh SVG.
let initialized = false
let initializedTheme: 'dark' | 'default' | null = null

export async function initMermaidOnce(theme: 'dark' | 'default'): Promise<void> {
  const mermaid = (await import('mermaid')).default
  if (initialized && initializedTheme === theme) return
  mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' })
  initialized = true
  initializedTheme = theme
}

export async function getMermaid(): Promise<typeof import('mermaid').default> {
  return (await import('mermaid')).default
}

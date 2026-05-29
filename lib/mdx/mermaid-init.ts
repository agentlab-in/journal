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

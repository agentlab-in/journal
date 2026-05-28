export default function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t border-border px-6 py-4">
      <p className="text-xs text-fg-subtle">© {year} agentlab</p>
    </footer>
  )
}

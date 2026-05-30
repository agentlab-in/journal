import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="font-mono text-sm text-fg-subtle">404</p>
      <h1 className="mt-2 font-mono text-2xl font-black lowercase tracking-tight text-fg">
        page not found
      </h1>
      <p className="mt-3 text-sm text-fg-subtle">
        This page doesn&apos;t exist yet.
      </p>
      <Link
        href="/"
        className="mt-6 text-sm text-fg underline underline-offset-4 hover:opacity-70"
      >
        back to agentlab
      </Link>
    </main>
  )
}

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <h1 className="font-mono text-4xl font-black lowercase tracking-tight text-[var(--fg)] sm:text-6xl">
        agentlab
      </h1>
      <p className="mt-4 text-base text-[var(--fg-subtle)] sm:text-lg">
        Community publishing for AI agent infrastructure.
      </p>
    </div>
  )
}

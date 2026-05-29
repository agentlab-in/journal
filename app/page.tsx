import Logo from '@/components/brand/Logo'
import WaitlistForm from '@/components/marketing/WaitlistForm'

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center text-fg">
      <Logo className="h-20 w-20 sm:h-24 sm:w-24" />
      <h1 className="mt-6 font-mono text-4xl font-black lowercase tracking-tight sm:text-6xl">
        agentlab
      </h1>
      <p className="mt-4 max-w-xl font-mono text-sm text-fg-subtle sm:text-base">
        Community publishing for AI agent infrastructure.
      </p>
      <p className="mt-2 font-mono text-sm text-fg-subtle sm:text-base">
        Coming soon — drop your email to hear when we open.
      </p>
      <WaitlistForm />
    </div>
  )
}

# agentlab

**agentlab.in** is a community publishing platform for AI agent infrastructure knowledge — posts, playbooks, and deep dives written by practitioners, for practitioners. Think Hacker News meets Substack, purpose-built for the systems side of AI agents.

## Development

```bash
# Install dependencies
pnpm install

# Copy env template
cp .env.example .env.local

# Start dev server at http://localhost:3000
pnpm dev
```

## Testing

```bash
# Unit tests (Vitest)
pnpm test

# E2E tests (Playwright — starts next dev automatically)
pnpm e2e
```

## Other scripts

```bash
pnpm typecheck   # TypeScript type-check (tsc --noEmit)
pnpm lint        # ESLint
pnpm format      # Prettier write
pnpm build       # Production build
```

## Environment variables

See `.env.example` for all required and optional variables with documentation.

## Architecture

Full implementation plan: [`docs/v1-plan.md`](docs/v1-plan.md)

**Stack:** Next.js (App Router) · TypeScript strict · Tailwind CSS · NextAuth.js · Supabase · Vitest · Playwright · Vercel

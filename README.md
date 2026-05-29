# agentlab

**agentlab.in** is a community publishing platform for AI agent infrastructure knowledge — posts, playbooks, and deep dives written by practitioners, for practitioners. Think Hacker News meets Substack, purpose-built for the systems side of AI agents.

## Development

```bash
# Install dependencies
pnpm install

# Copy env template
cp .env.example .env.local

# Start dev server at http://localhost:3010
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

## Supabase setup (one-time)

Before sign-in works locally, complete these against your Supabase project:

1. **Push the auth migration:**
   ```bash
   supabase db push   # applies supabase/migrations/0001_auth.sql
   ```
2. **Expose the `next_auth` schema to PostgREST.** In the Supabase dashboard:
   *Project Settings → API → Exposed schemas → add `next_auth`.* Without this
   the NextAuth adapter fails with `Invalid schema: next_auth (PGRST106)`.
3. **Fill `.env.local`** with `NEXTAUTH_SECRET`, `GITHUB_CLIENT_*`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`.
4. **GitHub OAuth app:** the dev callback URL is
   `http://localhost:3010/api/auth/callback/github` (port 3010, not 3000).

## Architecture

Full implementation plan: [`docs/v1-plan.md`](docs/v1-plan.md)

**Stack:** Next.js (App Router) · TypeScript strict · Tailwind CSS · NextAuth.js · Supabase · Vitest · Playwright · Vercel

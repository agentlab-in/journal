# Legal versions workflow

Each user-facing legal doc (Terms, Content Policy, Privacy Policy) is
pinned to a semver-style string in `lib/legal/versions.ts`. The version
is recorded in `public.consents` when the user agrees, and re-checked
on every authed request.

## When to bump

Bump the version when the doc gains a new rule, alters an existing
obligation, or otherwise changes what the user agreed to. Typo fixes
and link rewrites are NOT bumps.

## How to bump

1. Edit the doc markdown in `legal/<doc>.md`.
2. Update the `**Version:**` line in the doc to match the new tag.
3. Bump the same value in `lib/legal/versions.ts`.
4. Open a PR. On merge, every user is re-prompted on their next
   authed page load.

Do not delete or rename a doc's key in `LEGAL_VERSIONS` — the consent
records reference these by name.

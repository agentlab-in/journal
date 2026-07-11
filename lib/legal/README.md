# Legal docs

agentlab.in has a single legal document: `legal/terms-of-service.md`,
rendered at `/terms` via `lib/legal/docs.ts` and `LegalPage`. It covers
both the terms of use and the privacy notice in one page. Every other
legal URL (`/privacy`, `/policy`, `/grievance`, `/dmca`) permanently
redirects to `/terms` (see `next.config.ts`).

## Editing the doc

1. Edit `legal/terms-of-service.md` directly.
2. Keep the `**Effective Date:** Month D, YYYY` line current. The
   loader (`lib/legal/render.ts`) parses it and fails to render if the
   format drifts.
3. Open a PR. There is no per-user re-consent flow to trigger; the page
   simply reflects whatever is live.

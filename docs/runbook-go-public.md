# Go-public runbook

This flips agentlab.in from a private, gated dev site to a public, gated showcase.
Reads stay open to everyone; writing stays approved-only. The outward-facing step
(the repo visibility flip, Section 7) is last, on purpose. Rotate secrets before
that flip: git history becomes permanently public the instant the repo goes
public, so any live secret needs to already be dead by then.

Run every step in order. Steps are tagged `[owner]` (a human click or CLI action)
or `[automatable]` (already scripted, or a one-command action).

## 0. Pre-flight (do first, do not skip)

- [ ] **[owner]** Confirm the live domain and OAuth callback: read `NEXTAUTH_URL`
      from Vercel Production env and confirm the GitHub OAuth App "Authorization
      callback URL" is exactly `<NEXTAUTH_URL>/api/auth/callback/github`.
      Expected: they match, including trailing slash and http/https.
- [ ] **[owner]** Confirm whether Upstash is set in Vercel
      (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`). If unset, note
      that rate limiting falls back to the per-lambda in-memory limiter.
- [ ] **[automatable]** Migration ledger check: `supabase migration list --linked`
      (or query `supabase_migrations.schema_migrations`). Confirm the repo
      migrations 0024 and 0025 are the next unapplied numbers, with no
      collision against the live ledger (known 0018/0019 gap, 0013 -> 0017
      renumber). If they collide, renumber before applying anything.

## 1. Apply DB migrations (authorized pre-flip, gated on smoke test)

- [ ] **[automatable]** Apply 0024 then 0025 to the linked project:
      `supabase db push` (or `supabase migration up --linked`).
- [ ] **[owner/automatable]** Post-apply smoke test. All three must pass, or
      stop and fix before doing anything else:
  1. Approved writer (owner) inserts a post. Expected: succeeds.
  2. Unapproved author attempts a write. Expected: rejected with
     `writer not approved` raised by the trigger.
  3. Anon read of an existing post. Expected: still returns content.

## 2. Rotate secrets (owner, before the visibility flip)

Rotate in this order, highest blast radius first, and redeploy after each one
so the new value takes effect.

| Order | Secret | Where it is set | Rotate action |
|---|---|---|---|
| 1 | `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard (project API settings) and Vercel Production env | Regenerate in Supabase, paste the new value into Vercel, redeploy. Bypasses RLS, so this is the highest blast radius secret. |
| 2 | `NEXTAUTH_SECRET` | Vercel Production env | Generate a new value with `openssl rand -base64 32`, set it in Vercel, redeploy. |
| 3 | `GITHUB_CLIENT_SECRET` | GitHub OAuth App settings page and Vercel Production env | Generate a new client secret on the GitHub OAuth App page, set it in Vercel, redeploy. |
| 4 (optional) | `UPSTASH_REDIS_REST_TOKEN` | Upstash console and Vercel Production env | Rotate in Upstash, set the new token in Vercel, redeploy. Hygiene only. |

- [ ] **[owner]** Work through the table above in order, redeploying after
      each rotation.
- [ ] **[owner]** After the final redeploy, confirm `/api/health` returns
      200 `{ok:true,db:'ok'}`. Expected: that exact status and body, proving
      the new service-role key works end to end.

## 3. Env + settings changes (owner)

- [ ] **[owner]** Set `RATE_LIMIT_FAIL_OPEN=false` in Vercel (F3), so a
      limiter outage fails closed for write buckets. Expected: variable
      present in Production scope.
- [ ] **[owner]** Confirm `ADMIN_GITHUB_LOGINS` is set in Vercel Production
      (it is blanked in `.env.example`; the real value lives only in Vercel).
      Expected: variable present and non-empty.
- [ ] **[owner]** GitHub -> Settings -> Code security: enable Secret
      scanning, Push protection, Dependabot alerts, Dependabot security
      updates. Expected: all four show Enabled.

## 4. Email authentication DNS for agentlab.in (owner): Zoho Mail

Provider is Zoho Mail. Add these DNS records at the domain registrar.

- [ ] **[owner]** Add the SPF, DKIM, and DMARC records below at the
      registrar's DNS panel.

| Type | Host | Value | Notes |
|---|---|---|---|
| TXT (SPF) | `@` | `v=spf1 include:zoho.in ~all` | Confirm the include matches the Zoho data center region for this account (`zoho.in` for the India DC, `zoho.com` for US, `zoho.eu` for EU). Check the region from the Zoho admin console domain (mail.zoho.in vs .com vs .eu); do not guess the DC. Keep `~all` (softfail) until DKIM and DMARC are confirmed passing, then consider `-all`. |
| TXT (DKIM) | `<selector>._domainkey` | `v=DKIM1; k=rsa; p=<public-key>` | The selector and public key are generated in the Zoho admin console (Email Configuration -> DKIM, or Domains -> DKIM). Create the exact host/selector Zoho shows and paste the key value from the console; do not fabricate the key. |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:harshit@agentlab.in; ruf=mailto:harshit@agentlab.in; fo=1` | Start at `p=quarantine`, watch the `rua` aggregate reports for a week, then consider `p=reject`. MX records for receiving are assumed already set since the inbox is live. |

- [ ] **[owner]** Note: spoofing harshit@agentlab.in is now a real attack,
      since it is the approval, grievance, and takedown channel for the
      whole site.

## 5. CSP report collector (owner): keep Report-Only, wire reporting (F13, C4 option a)

Recommended: a hosted CSP report collector (for example report-uri.com or
URIports free tier), not an in-app email-forwarding route. Keep the header
Report-Only for this launch.

- [ ] **[owner]** Create a project on the hosted collector, get its report
      ingest URL, and configure it to email harshit@agentlab.in on new
      violations. Expected: these services dedupe and aggregate reports, so
      this does not flood the inbox.
- [ ] **[owner]** Add `report-uri <ingest-url>;` (and a matching `report-to`
      group) to the existing `Content-Security-Policy-Report-Only` header in
      `next.config.ts`. Keep it Report-Only, do not switch to enforcing yet.
- Note: a self-hosted alternative (a rate-limited `app/api/csp-report` route
  that emails via Zoho SMTP) is a fallback if a third-party collector is
  unacceptable, but it needs a new SMTP secret and carries ongoing
  maintenance, so the hosted option is preferred.
- [ ] **[owner]** Only flip to enforcing `Content-Security-Policy` after a
      week of clean reports AND a manual production page-walk (home, a post
      with code and Mermaid, the editor, an `/admin` page, `/auth/apply`,
      `/terms`) shows zero violations. That flip is its own separate change,
      not part of this runbook.

## 6. OAuth callback re-verify (owner)

- [ ] **[owner]** After secret rotation, sign in via GitHub on the live
      domain and confirm the round-trip completes and a session cookie is
      set. Expected: `__Secure-next-auth.session-token` cookie present
      (NEXTAUTH_URL is https).

## 7. Flip repo visibility to public (owner): LAST, outward-facing

- [ ] **[owner]** Confirm `git ls-files | grep -E '^\.env' | grep -v .env.example`
      is empty. Expected: no output.
- [ ] **[owner]** GitHub -> Settings -> General -> Danger Zone -> Change
      visibility -> Public. Expected: repo shows Public.

## 8. Post-flip smoke tests (owner)

Run every check below. Any failure means stop and diagnose before telling
anyone the site is live.

| Check | Command / action | Expected result |
|---|---|---|
| Anon read of home | `curl -s -o /dev/null -w '%{http_code}' https://agentlab.in/` | `200` |
| Anon read of a post page | Load a known post URL | `200`, content renders |
| Unauthenticated write | `curl -s -o /dev/null -w '%{http_code}' -X POST https://agentlab.in/api/posts` | `401` |
| Approved user publish | Sign in as an approved writer and publish a post | `201` |
| Unapproved sign-in | Sign in with a GitHub account not in `approved_users` | Redirects to `/auth/blocked?reason=not_approved` |
| Admin login | Sign in as an `ADMIN_GITHUB_LOGINS` account and load `/admin` | Page loads, not a 404 |
| Health check | `curl -s https://agentlab.in/api/health` | `200` with `{ok:true,db:'ok'}` |
| Repo visibility | `gh repo view --json isPrivate` | `isPrivate: false` |
| Secret scanning + push protection | GitHub -> Settings -> Code security | Both show Enabled |

## Rollback

Repo visibility can be flipped back to Private instantly, though that only
stops new anonymous clones; it does not erase any copy already made during
the public window, which is exactly why secrets are rotated before Section 7
and not after. Rotated secrets stay rotated regardless, there is no reason to
revert them. A failed migration smoke test in Section 1 is a cheap catch,
since at that point the site is still private with no external users:
identify which invariant broke (the trigger, the anon read policy, or the
writer check), fix it, and rerun the smoke test before applying the next
migration. If a post-flip smoke test in Section 8 fails, the prior Vercel
deployment is one click away in the Deployments tab to roll back.

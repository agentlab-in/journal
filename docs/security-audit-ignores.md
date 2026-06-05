# Security audit ignores

Findings deliberately deferred from the active `pnpm audit --prod` gate.
Each entry documents the CVE, why we cannot patch today, and the
condition under which the ignore must be revisited. Configured for pnpm
via `pnpm.auditConfig.ignoreCves` in `package.json`.

Reviewed at every release cut and at any change to the listed
upstream packages.

## Active ignores

### CVE-2026-41907 — `uuid <11.1.1` (transitive via `next-auth@4`)

- **Severity:** moderate (CVSS 7.5)
- **Source:** issue [#49](https://github.com/harshitsinghbhandari/agentlab-in/issues/49) (L2 finding from the 2026-06-01 pre-launch audit)
- **Advisory:** <https://github.com/advisories/GHSA-w5hq-g745-h8pq>
- **Path:** `next-auth → uuid@8.3.2`

#### Why we are not patching

The advisory describes a missing buffer-bounds check on `uuid.v3()`,
`uuid.v5()`, and `uuid.v6()` when a caller-supplied `buf` argument is
provided. `next-auth@4` calls only `uuid.v4()` and passes no `buf`, so
the vulnerable code paths are unreachable from our codebase.

The package-level fix is `uuid >= 11.1.1`, which is a breaking major
bump (8 → 11) that conflicts with `next-auth@4`'s pinned dependency.
Overriding `uuid` in `pnpm.overrides` produces an install that
`next-auth@4` will not validate against, so we are not adding an
override.

#### When to revisit

Drop this ignore the moment we land the planned upgrade to
`next-auth@5`, which ships against a current `uuid`. Tracked alongside
the rest of the next-auth migration. Until then, the ignore must stay
in place so CI's `pnpm audit` step stays green without masking other
findings.

#### How to verify the assertion still holds

```bash
# Re-confirm next-auth never calls v3/v5/v6 with a caller buf.
pnpm why uuid
grep -rE "uuid\.(v3|v5|v6)\(" node_modules/next-auth
```

If either of those surfaces a new call site (e.g. a next-auth patch
release), pull this ignore immediately and accept the breaking bump.

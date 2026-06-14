/**
 * Phase 11.5 — Read-only "Your orgs" section on /settings/profile.
 *
 * Orgs are GitHub-backed: membership is materialized by lib/orgs/github-sync
 * on sign-in, and there is no agentlab-side admin tier. So this section is
 * purely informational — display each org with a View link and surface an
 * empty-state nudge to join a GitHub org. Leaving an org is a GitHub action
 * (we'll mirror it on the next sign-in), so no Leave button lives here.
 */
import Link from 'next/link'
import { RefreshOrgsButton } from './RefreshOrgsButton'

export interface OrgListEntry {
  id: string
  slug: string
  display_name: string
}

export interface OrgsListSectionProps {
  orgs: OrgListEntry[]
}

export function OrgsListSection({ orgs }: OrgsListSectionProps) {
  return (
    <section
      className="settings-section"
      id="orgs"
      data-testid="orgs-list-section"
    >
      <h2 className="settings-section-heading">Your orgs</h2>

      {orgs.length === 0 ? (
        <>
          <p className="settings-help">
            You’re not in any orgs yet. Join a GitHub org, then refresh:
          </p>
          <div className="settings-actions">
            <RefreshOrgsButton />
          </div>
        </>
      ) : (
        <>
          <ul className="settings-orgs-list">
            {orgs.map((o) => (
              <li
                key={o.id}
                className="settings-orgs-row"
                data-testid={`orgs-row-${o.slug}`}
              >
                {/* Visual hierarchy (issue #68): the @handle is the primary,
                    prominent identifier; the display name rides secondary
                    beneath it; "View" reads as an actual bordered button so
                    the call-to-action no longer looks identical to the handle. */}
                <span className="settings-orgs-identity">
                  <span className="settings-orgs-handle">@{o.slug}</span>
                  <span className="settings-orgs-name">{o.display_name}</span>
                </span>
                <Link href={`/${o.slug}`} className="settings-orgs-view">
                  View
                </Link>
              </li>
            ))}
          </ul>
          <div className="settings-actions">
            <RefreshOrgsButton />
          </div>
        </>
      )}
    </section>
  )
}

export default OrgsListSection

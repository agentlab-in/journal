interface Props {
  consent: {
    consented_at: string
    terms_version: string
    content_policy_version: string
    privacy_policy_version: string
  } | null
}

export function ConsentSnapshotSection({ consent }: Props) {
  return (
    <section className="settings-section">
      <h2 className="settings-section-heading">Consent</h2>
      {consent ? (
        <p className="settings-help">
          You agreed to Terms {consent.terms_version}, Content Policy{' '}
          {consent.content_policy_version}, and Privacy Policy{' '}
          {consent.privacy_policy_version} on{' '}
          <time dateTime={consent.consented_at}>
            {new Date(consent.consented_at).toISOString().slice(0, 10)}
          </time>
          .
        </p>
      ) : (
        <p className="settings-help">No consent on record.</p>
      )}
    </section>
  )
}

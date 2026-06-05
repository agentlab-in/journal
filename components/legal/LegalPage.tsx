import Link from 'next/link'
import { LEGAL_DOCS, getLegalDoc, type LegalDoc } from '@/lib/legal/docs'
import { renderLegalDoc } from '@/lib/legal/render'
import { absoluteUrl } from '@/lib/site-url'

interface LegalPageProps {
  slug: LegalDoc['slug']
}

/** Format an ISO date for the user-visible "Last updated" stamp. */
function formatStamp(iso: string): string {
  // ISO date is YYYY-MM-DD; we display it as-is. Avoiding toLocaleString
  // here keeps server and client output byte-identical, which matters
  // for hydration and for the stamp being a stable canonical token search
  // engines can index.
  return iso
}

/**
 * Server component shared by all five /app/(legal)/<slug>/page.tsx
 * routes. Reads the markdown, renders it through the operator-content
 * pipeline (no sanitization), and wraps it in the article chrome.
 */
export async function LegalPage({ slug }: LegalPageProps) {
  const doc = getLegalDoc(slug)
  const { bodyHtml, effectiveDate, effectiveDateLabel } =
    await renderLegalDoc(slug)

  const others = LEGAL_DOCS.filter((d) => d.slug !== slug)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: doc.title,
    description: doc.description,
    url: absoluteUrl(`/${doc.slug}`),
    inLanguage: 'en',
    isPartOf: {
      '@type': 'WebSite',
      name: 'agentlab.in',
      url: absoluteUrl('/'),
    },
    datePublished: effectiveDate,
    dateModified: effectiveDate,
  }

  return (
    <main id="main-content" className="px-6 py-12">
      <script
        type="application/ld+json"
        // JSON.stringify is safe for inline <script> only when nested
        // `</` sequences are escaped. None of these fields are user-
        // supplied, but the escape keeps the page robust if the registry
        // copy is ever amended with a stray "</".
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/<\//g, '<\\/'),
        }}
      />
      <article className="mx-auto w-full max-w-3xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{doc.title}</h1>
          <p className="mt-2 text-sm text-fg-subtle">
            <span>Last updated: </span>
            <time dateTime={effectiveDate}>{formatStamp(effectiveDate)}</time>
            <span className="ml-2 text-fg-subtle">({effectiveDateLabel})</span>
          </p>
        </header>
        <div
          // .post-body provides the prose styles already used by the
          // post detail page — keeping the legal pages on the same
          // class means they automatically pick up any future
          // typography tweaks.
          className="post-body leading-relaxed"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
        <nav
          aria-label="Other legal pages"
          className="mt-16 border-t border-border pt-6"
        >
          <p className="text-xs uppercase tracking-wide text-fg-subtle">
            More legal
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {others.map((other) => (
              <li key={other.slug}>
                <Link
                  href={`/${other.slug}`}
                  className="text-fg underline underline-offset-2 hover:text-fg"
                >
                  {other.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </article>
    </main>
  )
}

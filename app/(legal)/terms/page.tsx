import { LegalPage } from '@/components/legal/LegalPage'
import { legalMetadata } from '@/lib/legal/metadata'

export const metadata = legalMetadata('terms')

export default function TermsPage() {
  return <LegalPage slug="terms" />
}

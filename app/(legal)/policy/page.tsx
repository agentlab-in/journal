import { LegalPage } from '@/components/legal/LegalPage'
import { legalMetadata } from '@/lib/legal/metadata'

export const metadata = legalMetadata('policy')

export default function ContentPolicyPage() {
  return <LegalPage slug="policy" />
}

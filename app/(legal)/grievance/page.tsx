import { LegalPage } from '@/components/legal/LegalPage'
import { legalMetadata } from '@/lib/legal/metadata'

export const metadata = legalMetadata('grievance')

export default function GrievancePage() {
  return <LegalPage slug="grievance" />
}

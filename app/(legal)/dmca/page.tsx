import { LegalPage } from '@/components/legal/LegalPage'
import { legalMetadata } from '@/lib/legal/metadata'

export const metadata = legalMetadata('dmca')

export default function DmcaPage() {
  return <LegalPage slug="dmca" />
}

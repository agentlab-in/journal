import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin'

export default async function AdminIndex() {
  const session = await getSession()
  await requireAdmin(session) // throws notFound() for non-admin; per-request defense-in-depth (layout is not an auth boundary)
  redirect('/admin/reports')
}

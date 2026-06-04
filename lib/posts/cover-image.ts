export function isValidCoverImageUrl(url: string): boolean {
  if (!url) return false
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  // A `..` or `.` segment in the literal string passes WHATWG URL
  // parsing but is normalised away before the request hits storage —
  // letting a caller break out of /covers/ into adjacent buckets.
  if (u.pathname.includes('/../') || u.pathname.includes('/./')) return false
  let supa: URL
  try {
    supa = new URL(supabaseUrl)
  } catch {
    return false
  }
  return u.origin === supa.origin && u.pathname.startsWith('/storage/v1/object/public/covers/')
}

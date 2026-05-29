export function isValidCoverImageUrl(url: string): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return false
  const expectedPrefix = `${supabaseUrl}/storage/v1/object/public/covers/`
  return typeof url === 'string' && url.length > expectedPrefix.length && url.startsWith(expectedPrefix)
}

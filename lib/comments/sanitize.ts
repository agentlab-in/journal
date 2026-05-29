export function sanitizeCommentBody(input: string): string {
  const withoutTags = input.replace(/<[^>]*>/g, '')
  const collapsed = withoutTags.replace(/[^\S\n]+/g, ' ')
  return collapsed.trim()
}

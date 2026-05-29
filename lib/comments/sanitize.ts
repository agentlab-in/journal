// Strips tags but keeps inner text — safe because the render layer
// emits bodies as plain text (React auto-escapes), NEVER via
// dangerouslySetInnerHTML. If that invariant ever changes, this regex
// is the trip-wire and needs to be replaced with a real HTML sanitiser.
export function sanitizeCommentBody(input: string): string {
  const withoutTags = input.replace(/<[^>]*>/g, '')
  const collapsed = withoutTags.replace(/[^\S\n]+/g, ' ')
  return collapsed.trim()
}

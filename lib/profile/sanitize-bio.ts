/**
 * Strip raw HTML tags from a user-supplied bio before persistence. The
 * profile bio is stored as markdown and rendered through the same
 * rehype-sanitize pipeline as post bodies (`renderBioToHtml`), but
 * persisting the raw input means any future surface that consumes the
 * column directly (e.g. plain-text fallbacks, exports, future JSON
 * endpoints) would inherit raw `<script>` / `<iframe>` payloads.
 *
 * Tags are stripped but inner text is preserved — markdown formatting
 * characters (`#`, `**`, `[]()`) are intentionally retained so the
 * downstream markdown renderer keeps working.
 */
export function sanitizeBio(input: string): string {
  return input.replace(/<[^>]*>/g, '')
}

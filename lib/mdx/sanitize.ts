import { defaultSchema } from 'rehype-sanitize'
import type { Options as SanitizeOptions } from 'rehype-sanitize'

type Schema = SanitizeOptions

/**
 * `sanitizeSchema` extends `rehype-sanitize`'s `defaultSchema` (which already
 * follows GitHub's allowlist — strips `<script>`, raw `<iframe>`, inline
 * event handlers, and `style` attributes) with:
 *
 *   - The five MDX allowlist tags (`callout`, `embed`, `figure`, `aside`,
 *     `detail`) and `figcaption`, `sub`, `sup` — all lowercase per HAST.
 *   - The whitelisted attributes on each, e.g. `callout type=info|tip|...`.
 *   - A class-name allowlist on `<code>`/`<pre>`/`<span>` that keeps the
 *     prism token classes emitted by `rehype-prism-plus` plus
 *     `language-*` so syntax highlighting and the Mermaid hook
 *     (`language-mermaid`) survive sanitation.
 *
 * This schema only does its job once MDX-JSX nodes have been converted to
 * plain HAST elements. The `compile.ts` pipeline runs that conversion
 * immediately before `rehype-sanitize`.
 */

// Prism token / utility classes emitted by rehype-prism-plus that we
// want to keep on `<span>` and `<code>`. The set is finite and bounded
// to satisfy the spec ("Easiest: add code allowed className array").
const PRISM_TOKEN_CLASSES = [
  'token',
  'keyword',
  'string',
  'number',
  'comment',
  'operator',
  'punctuation',
  'function',
  'class-name',
  'tag',
  'attr-name',
  'attr-value',
  'boolean',
  'constant',
  'symbol',
  'variable',
  'property',
  'regex',
  'important',
  'bold',
  'italic',
  'entity',
  'url',
  'selector',
  'atrule',
  'rule',
  'inserted',
  'deleted',
  'namespace',
  'parameter',
  'builtin',
  'literal-property',
  'code-line',
  'highlight-line',
  'code-highlight',
  'line-number',
] as const

const CALLOUT_TYPES = ['info', 'tip', 'warning', 'danger'] as const

const baseTagNames = defaultSchema.tagNames ?? []
const baseAttributes = defaultSchema.attributes ?? {}

export const sanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: [
    ...baseTagNames,
    // MDX allowlist (lowercase as per the conversion that runs first).
    'callout',
    'embed',
    'figure',
    'aside',
    'detail',
    // Supporting tags.
    'figcaption',
    // `sub` and `sup` are already in defaultSchema, but re-listing is harmless
    // and documents intent. defaultSchema also already covers `pre`/`code`.
  ],
  attributes: {
    ...baseAttributes,
    // Restrict callout `type` to one of the four labels.
    callout: [['type', ...CALLOUT_TYPES]],
    // Embed: a URL plus the provider hint that the React component dispatches on.
    embed: ['url', 'provider'],
    // Figure: src is URL-protocol-checked via `protocols.src` (http/https only).
    figure: ['src', 'alt', 'caption'],
    aside: [],
    detail: ['summary'],
    figcaption: [],
    sub: [],
    sup: [],
    // Keep prism token classes on <code> and <span>. defaultSchema already
    // allows `code: [['className', /^language-./]]`; we add the prism palette.
    code: [['className', /^language-./, ...PRISM_TOKEN_CLASSES]],
    span: [['className', ...PRISM_TOKEN_CLASSES]],
    pre: [['className', /^language-./, ...PRISM_TOKEN_CLASSES, 'code-highlight']],
  },
  // `style` is never in the default `*` list, but list it explicitly in the
  // strip set to keep the contract visible. `script` is already in
  // defaultSchema.strip.
  strip: [...(defaultSchema.strip ?? ['script']), 'style'],
  // Treat `url` on <embed> like an href: only http(s).
  // `srcSet` is listed defensively (L10): modern browsers already reject
  // `javascript:` candidate URLs, but the default schema doesn't restrict
  // protocols there — be explicit so future allowlist drift can't open a hole.
  protocols: {
    ...(defaultSchema.protocols ?? {}),
    url: ['http', 'https'],
    srcSet: ['http', 'https'],
  },
}

/**
 * Monotonically increasing version of the sanitize allowlist (H12). Bumped
 * by the operator whenever `sanitizeSchema` (or anything in the MDX render
 * pipeline that affects the stored `body_html`) gains or loses an
 * affordance. Stored `posts.sanitize_version` is compared against this on
 * read to decide whether a row's cached HTML is still consistent with the
 * current allowlist.
 *
 * Bump policy:
 *   - Add a tag/attribute/protocol that widens the allowlist → bump.
 *   - Drop a tag/attribute/protocol that narrows the allowlist → bump.
 *   - Cosmetic comment or rename with no behavioural change → don't bump.
 *
 * After bumping, an out-of-band sweep re-renders stale `body_html` rows.
 * Until then `PostBodyStatic` emits a warning log per stale read.
 */
export const SANITIZE_VERSION = 1


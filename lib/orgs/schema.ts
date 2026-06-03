import { z } from 'zod'

// ---------------------------------------------------------------------------
// Phase 11 — Org REST API Zod schemas
// ---------------------------------------------------------------------------

// Slug constraints mirror users.username conventions: lowercase kebab-case,
// 2..30 chars, must start/end with alphanumeric. Single-char slugs are
// rejected to match the spec.
export const OrgSlug = z
  .string()
  .min(2, 'must be at least 2 characters')
  .max(30, 'must be at most 30 characters')
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'must be lowercase kebab-case alphanumeric',
  )

const DisplayName = z.string().min(1).max(60)
const Bio = z.string().max(500)
// Avatar/cover URLs are validated as URL strings here only; bucket-prefix
// validation belongs to the storage layer. `null` is the explicit-clear
// signal, distinct from `undefined` (no change).
const ImageUrlNullable = z.union([z.string().url(), z.null()])

export const OrgCreateBody = z
  .object({
    slug: OrgSlug,
    display_name: DisplayName,
    bio: Bio.optional(),
  })
  .strict()

export const OrgUpdateBody = z
  .object({
    display_name: DisplayName.optional(),
    // Empty string is the explicit-clear signal for bio (route maps to NULL).
    bio: Bio.optional(),
    avatar_url: ImageUrlNullable.optional(),
    cover_image_url: ImageUrlNullable.optional(),
  })
  .strict()

const Username = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'must be lowercase')

const OrgRole = z.enum(['admin', 'member'])

export const OrgMemberAddBody = z
  .object({
    username: Username,
    role: OrgRole,
  })
  .strict()

export const OrgMemberRoleBody = z
  .object({
    role: OrgRole,
  })
  .strict()

export type OrgCreateInput = z.infer<typeof OrgCreateBody>
export type OrgUpdateInput = z.infer<typeof OrgUpdateBody>
export type OrgMemberAddInput = z.infer<typeof OrgMemberAddBody>
export type OrgMemberRoleInput = z.infer<typeof OrgMemberRoleBody>

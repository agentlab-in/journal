import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared admin API Zod schemas
// ---------------------------------------------------------------------------

// Tag slug — same regex as lib/posts/schema.ts TagSlug but up to 50 chars
// to match the DB CHECK `slug = lower(slug)` and allow reasonable lengths.
const AdminTagSlug = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case lowercase')

export const AdminBanBody = z
  .object({
    user_id: z.string().uuid(),
    reason: z.string().min(1).max(1000),
  })
  .strict()

export const AdminUnbanBody = z
  .object({
    user_id: z.string().uuid(),
  })
  .strict()

export const AdminTagApproveBody = z
  .object({
    slug: AdminTagSlug,
  })
  .strict()

export const AdminTagRejectBody = z
  .object({
    slug: AdminTagSlug,
    reason: z.string().min(1).max(1000),
  })
  .strict()

export const AdminReportResolveBody = z
  .object({
    resolution: z.enum(['dismissed', 'actioned']),
    notes: z.string().max(1000).optional(),
  })
  .strict()

export const AdminOrgBanBody = z
  .object({
    org_id: z.string().uuid(),
    reason: z.string().min(1).max(500),
  })
  .strict()

export const AdminOrgUnbanBody = z
  .object({
    org_id: z.string().uuid(),
  })
  .strict()

export type AdminBanInput = z.infer<typeof AdminBanBody>
export type AdminUnbanInput = z.infer<typeof AdminUnbanBody>
export type AdminTagApproveInput = z.infer<typeof AdminTagApproveBody>
export type AdminTagRejectInput = z.infer<typeof AdminTagRejectBody>
export type AdminReportResolveInput = z.infer<typeof AdminReportResolveBody>
export type AdminOrgBanInput = z.infer<typeof AdminOrgBanBody>
export type AdminOrgUnbanInput = z.infer<typeof AdminOrgUnbanBody>

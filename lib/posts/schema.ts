import { z } from 'zod'

const TagSlug = z
  .string()
  .min(1)
  .max(30)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case')

const TitleField = z.string().min(1).max(200)
const SummaryField = z.string().min(1).max(200)
const BodyField = z.string().min(1).max(200000)
const TagsField = z.array(TagSlug).min(1).max(5)
const CoverUrlField = z.string().url().optional()
const TypeField = z.enum(['post', 'playbook', 'dive'])

const OrgIdField = z.string().uuid().optional()

export const PostCreateBody = z
  .object({
    type: TypeField,
    title: TitleField,
    summary: SummaryField,
    body_md: BodyField,
    tags: TagsField,
    cover_image_url: CoverUrlField,
    org_id: OrgIdField,
  })
  .strict()

export const PostPatchBody = z
  .object({
    title: TitleField,
    summary: SummaryField,
    body_md: BodyField,
    tags: TagsField,
    cover_image_url: CoverUrlField,
    org_id: OrgIdField,
  })
  .strict()

export type PostCreateInput = z.infer<typeof PostCreateBody>
export type PostPatchInput = z.infer<typeof PostPatchBody>

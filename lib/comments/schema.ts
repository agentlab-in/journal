import { z } from 'zod'

const BodyField = z.string().min(1).max(5000)

export const CommentCreateBody = z
  .object({
    post_id: z.string().uuid(),
    parent_comment_id: z.string().uuid().nullable().optional(),
    body: BodyField,
  })
  .strict()

export const CommentPatchBody = z
  .object({
    body: BodyField,
  })
  .strict()

export type CommentCreateInput = z.infer<typeof CommentCreateBody>
export type CommentPatchInput = z.infer<typeof CommentPatchBody>

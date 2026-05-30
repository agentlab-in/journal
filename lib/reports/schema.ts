import { z } from 'zod'

export const ReportCreateBody = z
  .object({
    target_type: z.enum(['post', 'comment', 'user']),
    target_id: z.string().uuid(),
    reason: z.string().min(1).max(1000),
  })
  .strict()

export type ReportCreateInput = z.infer<typeof ReportCreateBody>

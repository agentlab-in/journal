import { z } from 'zod'

export const waitlistEmailSchema = z.object({
  email: z.email({ message: 'Enter a valid email address.' }).max(254),
})

export type WaitlistPayload = z.infer<typeof waitlistEmailSchema>

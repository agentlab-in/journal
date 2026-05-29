import { z } from 'zod'

export const MAX_PINS = 6

export const PinCreateBody = z
  .object({
    post_id: z.uuid(),
    position: z.int().min(1).max(MAX_PINS).optional(),
  })
  .strict()

export type PinCreateInput = z.infer<typeof PinCreateBody>

/**
 * Pick the next pin position given the user's existing positions.
 * Returns MAX(existing) + 1, or 1 if no pins exist. Caller is responsible
 * for ensuring count < MAX_PINS; this helper does NOT clamp to MAX_PINS so
 * a corrupt state (e.g. existing pin at position 6 but only 5 rows) surfaces
 * as a UNIQUE-constraint violation rather than a silent overwrite.
 */
export function nextPosition(existingPositions: number[]): number {
  if (existingPositions.length === 0) return 1
  return Math.max(...existingPositions) + 1
}

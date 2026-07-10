import { z } from "zod";

/**
 * Schema for POST /events request body.
 * source and type are required strings.
 * payload is a required object (free-form).
 * idempotencyKey is optional (used in Phase 3).
 */
export const CreateEventSchema = z.object({
  source: z.string().min(1, { message: "source must not be empty" }),
  type: z.string().min(1, { message: "type must not be empty" }),
  payload: z.record(z.unknown()),
  idempotencyKey: z.string().optional(),
});

export type CreateEventInput = z.infer<typeof CreateEventSchema>;

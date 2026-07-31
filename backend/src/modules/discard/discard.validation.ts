import { z } from "zod";

export const discardEntityTypeSchema = z.enum(["leave", "regularization", "dispute"]);
export type DiscardEntityType = z.infer<typeof discardEntityTypeSchema>;

/**
 * A discard credits leave back and rewrites attendance, so the reason is not
 * optional decoration — it is the only human record of why the approval was
 * wrong. Ten characters is enough to stop "ok" / "test" without being a chore.
 */
export const discardRequestSchema = z.object({
  reason: z.string().trim().min(10, "Reason must be at least 10 characters").max(1000),
});

export const discardHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  entityType: discardEntityTypeSchema.optional(),
  employeeId: z.string().trim().min(1).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

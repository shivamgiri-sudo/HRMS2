import { z } from "zod";

export const requestOtpSchema = z.object({
  email: z.string().email(),
});

export const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6).regex(/^\d{6}$/),
});

export const periodSchema = z.string().regex(/^\d{4}-\d{2}$/, "Period must be YYYY-MM");

export const processParamSchema = z.object({
  id: z.string().uuid(),
});

export const actionPlanFilterSchema = z.object({
  metricId: z.string().uuid().optional(),
  status: z.enum(["planned", "in_progress", "done", "delayed"]).optional(),
});

export const createActionPlanSchema = z.object({
  processId: z.string().uuid(),
  metricId: z.string().uuid(),
  actionText: z.string().min(1).max(1000),
  ownerLevel: z.enum(["analyst", "tl", "process_manager", "branch_head"]),
  ownerName: z.string().min(1).max(255),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["planned", "in_progress", "done", "delayed"]).default("planned"),
});

export const updateActionPlanSchema = createActionPlanSchema.partial().omit({ processId: true, metricId: true });

export const setGlideSchema = z.object({
  processId: z.string().uuid(),
  metricId: z.string().uuid(),
  month: periodSchema,
  committedValue: z.number().positive(),
});

export const updateGovernanceSchema = z.object({
  processId: z.string().uuid(),
  period: periodSchema,
  activityId: z.string().uuid(),
  completedCount: z.number().int().min(0),
});

export const createCommentarySchema = z.object({
  processId: z.string().uuid(),
  period: periodSchema,
  authorName: z.string().min(1).max(255),
  authorDesignation: z.string().min(1).max(255),
  body: z.string().min(1),
});

export const replyCommentarySchema = z.object({
  text: z.string().min(1).max(1000),
});

export const createClientUserSchema = z.object({
  clientId: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(255),
  designation: z.string().max(255).optional(),
  processIds: z.array(z.string().uuid()).min(1),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type CreateActionPlanInput = z.infer<typeof createActionPlanSchema>;
export type UpdateActionPlanInput = z.infer<typeof updateActionPlanSchema>;
export type SetGlideInput = z.infer<typeof setGlideSchema>;
export type UpdateGovernanceInput = z.infer<typeof updateGovernanceSchema>;
export type CreateCommentaryInput = z.infer<typeof createCommentarySchema>;
export type CreateClientUserInput = z.infer<typeof createClientUserSchema>;

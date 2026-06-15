import { z } from "zod";
import { validateCronExpression } from "./cronSchedule.js";

const INTEGRATION_TYPES = ["rest_pull", "rest_push", "database", "sftp", "file_upload"] as const;

export const createIntegrationSchema = z.object({
  integrationKey: z.string().trim().min(2).max(100),
  integrationName: z.string().trim().min(2).max(255),
  integrationType: z.enum(INTEGRATION_TYPES),
  vendorName: z.string().trim().max(255).nullable().optional(),
  baseUrl: z.string().trim().max(500).nullable().optional(),
  authType: z.string().trim().max(50).nullable().optional(),
  secretName: z.string().trim().max(255).nullable().optional(),
  configJson: z.record(z.unknown()).nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

export const updateIntegrationSchema = z.object({
  integrationName: z.string().trim().min(2).max(255).optional(),
  integrationType: z.enum(INTEGRATION_TYPES).optional(),
  vendorName: z.string().trim().max(255).nullable().optional(),
  baseUrl: z.string().trim().max(500).nullable().optional(),
  authType: z.string().trim().max(50).nullable().optional(),
  secretName: z.string().trim().max(255).nullable().optional(),
  configJson: z.record(z.unknown()).nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  activeStatus: z.boolean().optional(),
});

export const confirmFieldMapSchema = z.object({
  integrationKey: z.string().trim().min(1).max(100),
  sourceTable: z.string().trim().min(1).max(255).default("*"),
  sourceField: z.string().trim().min(1).max(255),
  targetTable: z.string().trim().min(1).max(100),
  targetColumn: z.string().trim().min(1).max(100),
  transform: z.string().trim().max(500).nullable().optional(),
});

export const upsertTableMapSchema = z.object({
  sourceTable: z.string().trim().min(1).max(255),
  targetTable: z.enum([
    "dialer_session_log",
    "integration_call_daily",
    "integration_biometric_daily",
  ]),
  syncMode: z.enum(["daily_aggregate"]).default("daily_aggregate"),
});

export const runFiltersSchema = z.object({
  integrationKey: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const upsertScheduleSchema = z.object({
  cronExpression: z
    .string()
    .trim()
    .min(5)
    .optional(),
  enabled: z.boolean().optional(),
})
  .refine((d) => d.cronExpression !== undefined || d.enabled !== undefined, {
    message: "Provide at least cronExpression or enabled",
  })
  .superRefine((data, ctx) => {
    if (!data.cronExpression) return;
    const error = validateCronExpression(data.cronExpression);
    if (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cronExpression"],
        message: `Invalid cron expression: ${error}`,
      });
    }
  });

export type CreateIntegrationInput = z.infer<typeof createIntegrationSchema>;
export type UpdateIntegrationInput = z.infer<typeof updateIntegrationSchema>;
export type ConfirmFieldMapInput = z.infer<typeof confirmFieldMapSchema>;
export type UpsertTableMapInput = z.infer<typeof upsertTableMapSchema>;
export type RunFilters = z.infer<typeof runFiltersSchema>;
export type UpsertScheduleInput = z.infer<typeof upsertScheduleSchema>;

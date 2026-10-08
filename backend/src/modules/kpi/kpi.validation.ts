import { z } from "zod";

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export const createMetricSchema = z.object({
  metricCode: z.string().trim().min(1).max(50),
  metricName: z.string().trim().min(1).max(255),
  category: z.enum(["operations", "quality", "sales", "hr", "custom"]),
  unit: z.string().trim().min(1).max(50),
  direction: z.enum(["higher_is_better", "lower_is_better"]),
});

export const createTemplateSchema = z.object({
  templateName: z.string().trim().min(1).max(255),
  description: z.string().trim().nullable().optional(),
});

export const addTemplateMetricSchema = z.object({
  metricId: z.string().uuid(),
  targetValue: z.number(),
  weightPct: z.number().min(0).max(100),
});

export const assignTemplateSchema = z.object({
  templateId: z.string().uuid(),
  designationId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  employeeId: z.string().optional(),
}).refine(
  d => d.designationId || d.departmentId || d.employeeId,
  { message: "Must specify at least one assignment target" }
);

export const recordScoreSchema = z.object({
  employeeId: z.string().uuid(),
  metricId: z.string().uuid(),
  period: z.string().regex(MONTH_REGEX, "period must be YYYY-MM"),
  actualValue: z.number(),
  source: z.enum(["manual", "system", "dialer"]).optional(),
});

export const bulkScoreSchema = z.object({
  period: z.string().regex(MONTH_REGEX, "period must be YYYY-MM"),
  scores: z.array(z.object({
    employeeId: z.string().uuid(),
    metricId: z.string().uuid(),
    actualValue: z.number(),
    source: z.enum(["manual", "system", "dialer"]).optional(),
  })).min(1),
});

const KPI_FAMILY = z.enum(["operations", "quality", "performance", "custom"]);

export const metricsFiltersSchema = z.object({
  family: KPI_FAMILY.optional(),
});

/**
 * Leaderboard filters.
 *
 * snake_case aliases are accepted deliberately. The Operations KPI page sends
 * `process_id`, this schema declared only `processId`, and zod strips unknown keys
 * by default — so the Process dropdown was silently discarded and the leaderboard
 * was ALWAYS org-wide regardless of selection. Nothing errored; the filter simply
 * vanished. The CEO UAT saw the symptom (a leaderboard that ignored the filter and
 * showed employees from every process) without the cause being visible.
 *
 * Accepting both spellings and normalising to camelCase means neither a caller nor
 * a future refactor can lose the filter again. `.strict()` was considered and
 * rejected: it would turn every existing snake_case caller into a 400 rather than
 * fixing them.
 */
export const leaderboardFiltersSchema = z
  .object({
    period: z.union([z.string(), z.number()]).pipe(z.coerce.string()).pipe(z.string().regex(MONTH_REGEX, "period must be YYYY-MM")),
    templateId: z.string().uuid().optional(),
    template_id: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    branch_id: z.string().uuid().optional(),
    processId: z.string().uuid().optional(),
    process_id: z.string().uuid().optional(),
    family: KPI_FAMILY.optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
  })
  .transform((v) => ({
    period: v.period,
    family: v.family,
    limit: v.limit,
    templateId: v.templateId ?? v.template_id,
    branchId: v.branchId ?? v.branch_id,
    processId: v.processId ?? v.process_id,
  }));

export type CreateMetricInput = z.infer<typeof createMetricSchema>;
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type AddTemplateMetricInput = z.infer<typeof addTemplateMetricSchema>;
export type AssignTemplateInput = z.infer<typeof assignTemplateSchema>;
export type RecordScoreInput = z.infer<typeof recordScoreSchema>;
export type BulkScoreInput = z.infer<typeof bulkScoreSchema>;
export type MetricsFilters = z.infer<typeof metricsFiltersSchema>;
export type LeaderboardFilters = z.infer<typeof leaderboardFiltersSchema>;

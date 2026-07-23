import { z } from "zod";

export const dashboardScopeSchema = z.object({
  level: z.string().min(1),
  branchIds: z.array(z.string()),
  processIds: z.array(z.string()),
  employeeIds: z.array(z.string()).optional(),
  userId: z.string().min(1),
  role: z.string().min(1),
});

export const dashboardMetricSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  value: z.union([z.number(), z.string(), z.null()]),
  unit: z.string(),
  available: z.boolean(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  source: z.string().min(1),
  sourceTable: z.string().nullable(),
  asOf: z.string().datetime().nullable(),
  periodStart: z.string().datetime().nullable(),
  periodEnd: z.string().datetime().nullable(),
  timezone: z.string().min(1),
  scope: dashboardScopeSchema.pick({
    level: true,
    branchIds: true,
    processIds: true,
    employeeIds: true,
  }),
  numerator: z.number().nullable(),
  denominator: z.number().nullable(),
  target: z.number().nullable(),
  previousValue: z.number().nullable(),
  variancePct: z.number().nullable(),
  trend: z.enum(["up", "down", "stable"]).nullable(),
  status: z.enum(["healthy", "warning", "critical", "unknown"]),
  drilldownUrl: z.string().nullable(),
  // Transitional detail payload for existing role layouts. Canonical fields above
  // remain authoritative; this is removed after every drill-down is migrated.
  detail: z.record(z.string(), z.number().nullable()).optional(),
});

export const dashboardSummarySchema = z.object({
  dashboardCode: z.string().min(1),
  generatedAt: z.string().datetime(),
  scope: dashboardScopeSchema,
  workItems: z.object({
    pending_count: z.coerce.number(),
    overdue_count: z.coerce.number(),
  }).optional(),
  metrics: z.record(z.string(), dashboardMetricSchema),
});

export type DashboardMetric = z.infer<typeof dashboardMetricSchema>;
export type DashboardSummaryContract = z.infer<typeof dashboardSummarySchema>;

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
  // Distance from TARGET. Null when no target is configured.
  variancePct: z.number().nullable(),
  // Change from the PREVIOUS snapshot. Null until the snapshot writer has two days of
  // history. Distinct from variancePct: a tile labelled "vs last period" must read this.
  changePct: z.number().nullable(),
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
  // The inbox is a union of two independently-written tables (see
  // work-inbox.service.ts#getUnifiedInboxSummary). `overdue_count` counts only rows
  // that carry a real due date; `aged_count` is the age-based signal for the rows that
  // have none, kept separate so an age is never presented as a missed deadline.
  workItems: z.object({
    pending_count: z.coerce.number(),
    overdue_count: z.coerce.number(),
    aged_count: z.coerce.number().optional(),
    unread_count: z.coerce.number().optional(),
    by_source: z.record(z.string(), z.coerce.number()).optional(),
    by_type: z.array(z.object({
      type: z.string(),
      priority: z.string(),
      count: z.coerce.number(),
      actionUrl: z.string().nullable().optional(),
    })).optional(),
  }).optional(),
  metrics: z.record(z.string(), dashboardMetricSchema),
});

export type DashboardMetric = z.infer<typeof dashboardMetricSchema>;
export type DashboardSummaryContract = z.infer<typeof dashboardSummarySchema>;

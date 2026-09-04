import { z } from "zod";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export const netSalaryParamsSchema = z.object({
  grossMonthlyCTC: z.number().positive(),
  workingDays: z.number().int().min(1).max(31),
  lwpDays: z.number().min(0).default(0),
  pfEmployeePct: z.number().min(0).max(100).default(12),
  esicEmployeePct: z.number().min(0).max(100).default(0.75),
  esicWageLimit: z.number().positive().default(21000),
  pfWageLimit: z.number().positive().default(15000),
  professionalTax: z.number().min(0).default(0),
  tds: z.number().min(0).default(0),
  basicPct: z.number().min(1).max(100).default(40),
  hraPct: z.number().min(0).max(100).default(20),
});

export const createStructureSchema = z.object({
  structureCode: z.string().trim().min(1).max(50),
  structureName: z.string().trim().min(1).max(255),
  description: z.string().trim().nullable().optional(),
  basicPct: z.number().min(1).max(100).optional(),
  hraPct: z.number().min(0).max(100).optional(),
});

export const bulkAssignSchema = z.object({
  structureId: z.string().uuid(),
  ctcAnnual: z.number().positive(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  processId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  // Salary governance fields
  salarySlabId: z.string().nullable().optional(),
  salaryProposalId: z.string().nullable().optional(),
  approvalReferenceId: z.string().nullable().optional(),
  migrationMode: z.boolean().optional(),
  reason: z.string().trim().nullable().optional(),
});

export const createComponentSchema = z.object({
  componentCode: z.string().trim().min(1).max(50),
  componentName: z.string().trim().min(1).max(100),
  componentType: z.enum(["earning", "deduction", "statutory"]),
  taxable: z.boolean().default(true),
});

export const addStructureComponentSchema = z.object({
  structureId: z.string().uuid(),
  componentId: z.string().uuid(),
  calcType: z.enum(["fixed", "percentage"]).default("fixed"),
  value: z.number().min(0),
  sequence: z.coerce.number().int().min(1).default(1),
});

export const assignSalarySchema = z.object({
  employeeId: z.string().uuid(),
  structureId: z.string().uuid(),
  ctcAnnual: z.number().min(0),
  effectiveFrom: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD"),
  effectiveTo: z.string().regex(DATE_REGEX).nullable().optional(),
  // Salary governance fields (required for bypass gate)
  salarySlabId: z.string().nullable().optional(),
  salaryProposalId: z.string().nullable().optional(),
  approvalReferenceId: z.string().nullable().optional(),
  migrationMode: z.boolean().optional(),
  reason: z.string().trim().nullable().optional(),
});

export const createRunSchema = z.object({
  runMonth: z.string().regex(MONTH_REGEX, "runMonth must be YYYY-MM"),
  /*
   * Supplying cost centres makes the run scoped: it pays exactly those cost centres, and may span
   * branches. Omitting them keeps the legacy company-wide behaviour, which is what all 104 existing
   * runs are.
   *
   * `.min(1)` matters — an empty array must not be accepted as "scoped with no cost centres",
   * because that would fall through to an unfiltered population, i.e. the whole company from a
   * screen that said it was paying none of it.
   */
  costCentreIds: z.array(z.string().trim().min(1)).min(1).optional(),
  branchFilter: z.string().trim().nullable().optional(),
  processFilter: z.string().trim().nullable().optional(),
});

export const updateRunStatusSchema = z.object({
  // Exactly the statuses this endpoint can actually reach, per payroll-lifecycle.ts.
  //
  // It previously also accepted "processing" and "reviewed", neither of which any
  // transition targets, so both were guaranteed to fail after validation had passed -
  // surfacing as a 500 from the service rather than a 400 from the schema. "reviewed" is
  // never written to salary_prep_run by anything in the codebase at all (the only writer
  // of that value targets kpi_score_period, a different module), and "processing" is
  // written solely by the calculator, directly, never through this endpoint.
  //
  // Narrowing does not disable any working flow: no request using either value has ever
  // been able to succeed. It only makes the failure honest and immediate. NOTE this is
  // the TARGET status - 'processing' remains fully valid as a SOURCE status and is
  // untouched everywhere it is read (sign-off queue, is_draft, isProvisional).
  status: z.enum(["approved", "locked", "disbursed"]),
  /**
   * Break-glass past the mandatory Finance sign-off on LOCK / DISBURSE.
   *
   * Owner ruling 2026-08-16: allowed only for an exceptional operational emergency, requires
   * a reason, records who invoked it and when, and must be invoked by someone who is neither
   * the run's preparer nor its approver. A minimum length is enforced because "ok" is not a
   * reason anyone can audit later.
   */
  breakGlassReason: z.string().trim().min(20).max(500).optional(),
  disbursedAt: z.string().regex(DATE_REGEX).optional(),
});

export const updatePrepLineSchema = z.object({
  presentDays: z.number().min(0).optional(),
  lwpDays: z.number().min(0).optional(),
  lateMark: z.coerce.number().int().min(0).optional(),
  dialerHours: z.number().min(0).optional(),
  remarks: z.string().trim().nullable().optional(),
});

export const updateOvertimeSchema = z.object({
  overtimeHours: z.number().min(0).max(200),
  overtimeAmount: z.number().min(0),
});

export const runFiltersSchema = z.object({
  runMonth: z.string().regex(MONTH_REGEX).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  status: z.string().optional(),
  branchId: z.string().uuid().optional(),
  processId: z.string().uuid().optional(),
  search: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
});

export const advanceSchema = z.object({
  employeeId: z.string().uuid(),
  amount: z.number().positive(),
  advanceDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD"),
  recoveryMonths: z.coerce.number().int().min(1).default(1),
  notes: z.string().trim().nullable().optional(),
});

export type NetSalaryParamsInput = z.infer<typeof netSalaryParamsSchema>;
export type CreateStructureInput = z.infer<typeof createStructureSchema>;
export type BulkAssignSchemaInput = z.infer<typeof bulkAssignSchema>;
export type CreateComponentInput = z.infer<typeof createComponentSchema>;
export type AddStructureComponentInput = z.infer<typeof addStructureComponentSchema>;
export type AssignSalaryInput = z.infer<typeof assignSalarySchema>;
export type CreateRunInput = z.infer<typeof createRunSchema>;
export type UpdateRunStatusInput = z.infer<typeof updateRunStatusSchema>;
export type UpdatePrepLineInput = z.infer<typeof updatePrepLineSchema>;
export type UpdateOvertimeInput = z.infer<typeof updateOvertimeSchema>;
export type RunFilters = z.infer<typeof runFiltersSchema>;
export type AdvanceInput = z.infer<typeof advanceSchema>;

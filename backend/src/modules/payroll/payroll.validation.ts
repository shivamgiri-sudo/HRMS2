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
});

export const createRunSchema = z.object({
  runMonth: z.string().regex(MONTH_REGEX, "runMonth must be YYYY-MM"),
  branchFilter: z.string().trim().nullable().optional(),
  processFilter: z.string().trim().nullable().optional(),
});

export const updateRunStatusSchema = z.object({
  status: z.enum(["processing", "reviewed", "approved", "locked", "disbursed"]),
  disbursedAt: z.string().regex(DATE_REGEX).optional(),
});

export const updatePrepLineSchema = z.object({
  presentDays: z.number().min(0).optional(),
  lwpDays: z.number().min(0).optional(),
  lateMark: z.coerce.number().int().min(0).optional(),
  dialerHours: z.number().min(0).optional(),
  remarks: z.string().trim().nullable().optional(),
});

export const runFiltersSchema = z.object({
  runMonth: z.string().regex(MONTH_REGEX).optional(),
  status: z.string().optional(),
  branchId: z.string().uuid().optional(),
  processId: z.string().uuid().optional(),
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
export type RunFilters = z.infer<typeof runFiltersSchema>;
export type AdvanceInput = z.infer<typeof advanceSchema>;

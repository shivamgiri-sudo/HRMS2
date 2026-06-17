import { z } from "zod";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const createExitRequestSchema = z.object({
  employeeId: z.string().uuid().optional(),
  employee_id: z.string().uuid().optional(),
  exitDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
  lastWorkingDayProposed: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
  exitType: z.enum(["voluntary", "involuntary"]),
  exitSubType: z
    .enum(["resignation", "retirement", "mutual_separation", "termination", "absconding", "contract_end", "abandonment"])
    .optional()
    .default("resignation"),
  exitReasonCategory: z.string().trim().max(100).nullable().optional(),
  reason: z.string().trim().nullable().optional(),
  resignationReason: z.string().trim().nullable().optional(),
  noticePeriodDays: z.coerce.number().int().min(0).default(0),
}).transform((v) => ({
  employeeId: v.employeeId ?? v.employee_id,
  exitDate: v.exitDate ?? v.lastWorkingDayProposed,
  exitType: v.exitType,
  exitSubType: v.exitSubType,
  exitReasonCategory: v.exitReasonCategory ?? null,
  reason: v.reason ?? v.resignationReason ?? null,
  noticePeriodDays: v.noticePeriodDays,
})).refine((v) => !!v.employeeId, { message: "employeeId is required", path: ["employeeId"] })
  .refine((v) => !!v.exitDate, { message: "exitDate is required", path: ["exitDate"] });

export const updateExitStatusSchema = z.object({
  status: z.enum([
    "draft", "submitted", "manager_review", "hr_review", "admin_review",
    "accepted", "rejected", "revoked", "notice_serving", "exited", "exit_confirmed",
  ]),
  remarks: z.string().trim().min(1, "Remarks are required"),
  internalNotes: z.string().trim().nullable().optional(),
}).transform((v) => ({ ...v, status: v.status === "exit_confirmed" ? "exited" : v.status }));

export const listExitRequestsSchema = z.object({
  status: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  managerEmployeeId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  processId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateExitRequestInput = z.infer<typeof createExitRequestSchema>;
export type UpdateExitStatusInput = z.infer<typeof updateExitStatusSchema>;
export type ListExitRequestsInput = z.infer<typeof listExitRequestsSchema>;

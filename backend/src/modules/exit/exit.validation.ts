import { z } from "zod";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const createExitRequestSchema = z.object({
  employeeId: z.string().uuid().optional(),
  employee_id: z.string().uuid().optional(),
  // HR knows people as MAS63193, not as a UUID. Accepted alongside the id and resolved
  // server-side by resolveEmployeeRef; employee_code is unique, so it identifies one person.
  employeeCode: z.string().trim().max(50).optional(),
  employee_code: z.string().trim().max(50).optional(),
  exitDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
  lastWorkingDayProposed: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
  exitType: z.enum(["voluntary", "involuntary"]),
  exitSubType: z
    .enum(["resignation", "retirement", "mutual_separation", "termination", "absconding", "contract_end", "abandonment"])
    .optional()
    .default("resignation"),
  exitReasonCategory: z.string().trim().max(100).nullable().optional(),
  // The last date the employee actually worked, for absconding/abandonment.
  //
  // The New Exit form has demanded this as a mandatory field since it was written and the value
  // never left the browser: submitRequest() did not send it, this schema had no field to accept
  // it, and exit_request had no column to store it. Accepted here as of migration 1760.
  abscondingSince: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").nullable().optional(),
  absconding_since: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").nullable().optional(),
  reason: z.string().trim().nullable().optional(),
  resignationReason: z.string().trim().nullable().optional(),
  // Optional, NOT .default(0).
  //
  // Company policy is a 30-day notice period for everyone, which the reporting manager may
  // change. Defaulting to 0 here made "the caller said nothing" and "the caller said zero
  // notice" the same value, so the service could not apply the 30-day default without also
  // overriding a deliberate zero — and zero is meaningful: an absconding or terminated
  // employee serves no notice. Left undefined so exitService.createExitRequest can tell the
  // two apart.
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
}).transform((v) => ({
  employeeId: v.employeeId ?? v.employee_id,
  employeeCode: v.employeeCode ?? v.employee_code,
  exitDate: v.exitDate ?? v.lastWorkingDayProposed,
  exitType: v.exitType,
  exitSubType: v.exitSubType,
  exitReasonCategory: v.exitReasonCategory ?? null,
  abscondingSince: v.abscondingSince ?? v.absconding_since ?? null,
  reason: v.reason ?? v.resignationReason ?? null,
  noticePeriodDays: v.noticePeriodDays,
})).refine((v) => !!v.employeeId || !!v.employeeCode, {
    message: "employeeId or employeeCode is required",
    path: ["employeeId"],
  })
  .refine((v) => !!v.exitDate, { message: "exitDate is required", path: ["exitDate"] })
  // Enforced server-side, not only in the form. The date IS the employee's last working day for
  // these sub-types (owner ruling 2026-09-12) and therefore the date payroll prorates their
  // final month to — so an absconding raised through the API without it would silently fall
  // back to whatever exitDate the caller supplied, which is the failure this replaces.
  .refine(
    (v) => !["absconding", "abandonment"].includes(String(v.exitSubType)) || !!v.abscondingSince,
    {
      message: "abscondingSince is required for an absconding or abandonment exit — it is the last date the employee actually worked",
      path: ["abscondingSince"],
    }
  );

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

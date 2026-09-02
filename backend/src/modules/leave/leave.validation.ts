import { z } from "zod";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DB_ID = z.string().trim().min(1).max(36);

export const createLeaveTypeSchema = z.object({
  leaveCode: z.string().trim().min(1).max(20),
  leaveName: z.string().trim().min(1).max(100),
  maxDaysPerYear: z.coerce.number().int().min(0).default(0),
  carryForward: z.boolean().default(false),
  requiresApproval: z.boolean().default(true),
  paidLeave: z.boolean().default(true),
});

export const leaveRequestSchema = z
  .object({
    employeeId: DB_ID,
    leaveTypeId: DB_ID,
    fromDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD"),
    toDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD"),
    totalDays: z.number().min(0.5).max(182),
    reason: z.string().trim().nullable().optional(),
  })
  .refine((d) => d.toDate >= d.fromDate, { message: "toDate must be >= fromDate" })
  .refine(d => {
    const from = new Date(d.fromDate).getTime();
    const to   = new Date(d.toDate).getTime();
    const calendarDays = (to - from) / (1000 * 60 * 60 * 24) + 1;
    return d.totalDays <= calendarDays;
  }, {
    message: "totalDays cannot exceed the number of calendar days in the date range",
    path: ["totalDays"],
  });

export const reviewLeaveSchema = z.object({
  status: z.enum(["approved", "rejected", "branch_head_approved", "branch_head_rejected", "cancelled"]),
  remarks: z.string().trim().nullable().optional(),
});

export const leaveRequestFiltersSchema = z.object({
  employeeId: DB_ID.optional(),
  managerEmployeeId: DB_ID.optional(),
  leaveTypeId: DB_ID.optional(),
  status: z.string().optional(),
  fromDate: z.string().regex(DATE_REGEX).optional(),
  toDate: z.string().regex(DATE_REGEX).optional(),
  activeOn: z.string().regex(DATE_REGEX).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Scope narrowing for a holiday. The attendance engine's rule (see
// attendance-engine.service.ts resolveOverridePriority and
// shared/leaveChargeableDays.ts) is "no mapping rows for this holiday => it
// applies to everyone in the branch". So an EMPTY array and an OMITTED field
// mean the same thing — branch-wide — and narrowing only takes effect once at
// least one id is supplied.
const holidayScopeShape = {
  costCentreIds: z.array(z.string().uuid()).max(500).optional(),
  designationIds: z.array(z.string().uuid()).max(500).optional(),
};

export const createHolidaySchema = z.object({
  holidayName: z.string().trim().min(1).max(255),
  holidayDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD"),
  holidayType: z.enum(["national", "regional", "optional"]).default("national"),
  branchId: z.string().uuid().nullable().optional(),
  ...holidayScopeShape,
});

// Both arrays are required on update so the caller always states the full
// intended scope. A partial update would be ambiguous: omitting a key could
// mean "leave it alone" or "clear it", and getting that wrong silently widens
// a holiday to the whole branch.
export const updateHolidayScopeSchema = z.object({
  costCentreIds: z.array(z.string().uuid()).max(500),
  designationIds: z.array(z.string().uuid()).max(500),
});

export type CreateLeaveTypeInput = z.infer<typeof createLeaveTypeSchema>;
export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;
export type ReviewLeaveInput = z.infer<typeof reviewLeaveSchema>;
export type LeaveRequestFilters = z.infer<typeof leaveRequestFiltersSchema>;
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type UpdateHolidayScopeInput = z.infer<typeof updateHolidayScopeSchema>;

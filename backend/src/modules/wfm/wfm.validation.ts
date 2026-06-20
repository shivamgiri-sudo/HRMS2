import { z } from "zod";

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const createShiftSchema = z.object({
  shiftCode: z.string().trim().min(2).max(50),
  shiftName: z.string().trim().min(2).max(255),
  startTime: z.string().regex(TIME_REGEX, "Time must be HH:MM"),
  endTime: z.string().regex(TIME_REGEX, "Time must be HH:MM"),
  requiredMinutes: z.coerce.number().int().min(1).max(1440).default(540),
  branchName: z.string().trim().max(255).nullable().optional(),
  processName: z.string().trim().max(255).nullable().optional(),
});

export const updateShiftSchema = z.object({
  shiftName: z.string().trim().min(2).max(255).optional(),
  startTime: z.string().regex(TIME_REGEX, "Time must be HH:MM").optional(),
  endTime: z.string().regex(TIME_REGEX, "Time must be HH:MM").optional(),
  requiredMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  branchName: z.string().trim().max(255).nullable().optional(),
  processName: z.string().trim().max(255).nullable().optional(),
  activeStatus: z.boolean().optional(),
});

export const rosterPlanSchema = z
  .object({
    planName: z.string().trim().min(1).max(255),
    processId: z.string().uuid().nullable().optional(),
    branchId: z.string().uuid().nullable().optional(),
    shiftId: z.string().uuid().nullable().optional(),
    fromDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD"),
    toDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD"),
    requiredHeadcount: z.coerce.number().int().min(0).default(0),
  })
  .refine((d) => d.toDate >= d.fromDate, { message: "toDate must be >= fromDate" });

export const rosterAssignSchema = z.object({
  employeeId: z.string().uuid(),
  shiftId: z.string().uuid().nullable().optional(),
  planId: z.string().uuid().nullable().optional(),
  rosterDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD"),
  rosterStatus: z.string().max(50).default("Rostered"),
  branchName: z.string().trim().max(255).nullable().optional(),
  processName: z.string().trim().max(255).nullable().optional(),
});

export const attendanceSessionFiltersSchema = z.object({
  employeeId: z.string().uuid().optional(),
  fromDate: z.string().regex(DATE_REGEX).optional(),
  toDate: z.string().regex(DATE_REGEX).optional(),
  status: z.string().optional(),
  processName: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const clockInSchema = z.object({
  // employeeId removed - derived from auth token for security (prevents spoofing)
  sessionDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD"),
  punchSource: z.enum(["MANUAL", "BIOMETRIC", "DIALER"]).default("MANUAL"),
  branchName: z.string().trim().max(255).nullable().optional(),
  processName: z.string().trim().max(255).nullable().optional(),
}).refine(d => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return new Date(d.sessionDate) <= today;
}, {
  message: "Cannot clock in for a future date",
  path: ["sessionDate"],
});

export const clockOutSchema = z.object({
  sessionId: z.string().uuid(),
});

export const breakSchema = z.object({
  sessionId: z.string().uuid(),
  breakType: z.enum(["Break", "Lunch", "Bio", "Training"]),
});

export const DISPUTE_TYPES = [
  'missing_punch',
  'wrong_punch',
  'late_mark_dispute',
  'early_logout_dispute',
  'half_day_dispute',
  'absent_wrongly_marked',
  'week_off_worked',
  'holiday_worked',
  'shift_mismatch',
  'cosec_sync_issue',
  'manual_punch_correction',
] as const;

export type DisputeType = typeof DISPUTE_TYPES[number];

export const regularizationSchema = z.object({
  // employeeId removed - derived from auth token for security
  sessionDate:     z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD"),
  reason:          z.string().trim().min(1).max(500),
  reasonCode:      z.string().min(1).max(50).optional(),
  requestedStatus: z.enum(['present', 'half_day', 'absent']).optional(),
  supportingNote:  z.string().trim().nullable().optional(),
  // Dispute extension fields (optional — null = plain regularization)
  disputeType:     z.enum(DISPUTE_TYPES).nullable().optional(),
  oldStatus:       z.string().trim().nullable().optional(),
  newStatus:       z.string().trim().nullable().optional(),
  oldPunchIn:      z.string().regex(TIME_REGEX, "Time must be HH:MM").nullable().optional(),
  oldPunchOut:     z.string().regex(TIME_REGEX, "Time must be HH:MM").nullable().optional(),
  newPunchIn:      z.string().regex(TIME_REGEX, "Time must be HH:MM").nullable().optional(),
  newPunchOut:     z.string().regex(TIME_REGEX, "Time must be HH:MM").nullable().optional(),
  supportingDocId: z.string().trim().nullable().optional(),
}).refine(d => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return new Date(d.sessionDate) <= today;
}, {
  message: "Cannot regularize a future date",
  path: ["sessionDate"],
});

export const reviewRegularizationSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewerNote: z.string().trim().nullable().optional(),
});

export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
export type RosterPlanInput = z.infer<typeof rosterPlanSchema>;
export type RosterAssignInput = z.infer<typeof rosterAssignSchema>;
export type AttendanceSessionFilters = z.infer<typeof attendanceSessionFiltersSchema>;
export type ClockInInput = z.infer<typeof clockInSchema>;
export type ClockOutInput = z.infer<typeof clockOutSchema>;
export type BreakInput = z.infer<typeof breakSchema>;
export type RegularizationInput = z.infer<typeof regularizationSchema>;
export type ReviewRegularizationInput = z.infer<typeof reviewRegularizationSchema>;

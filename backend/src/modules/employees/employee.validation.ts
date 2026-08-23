import { z } from "zod";
import { isOfficialEmail, OFFICIAL_EMAIL_MESSAGE } from "../../shared/officialEmail.js";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const officialEmail = z.string().trim().email().refine(isOfficialEmail, OFFICIAL_EMAIL_MESSAGE);
const personalEmail = z.string().trim().email(); // No domain restriction for personal emails

export const createEmployeeSchema = z.object({
  employeeCode: z.string().trim().min(1).max(50),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).nullable().optional(),
  email: officialEmail.nullable().optional(),
  mobile: z.string().trim().max(20).nullable().optional(),
  personalEmail: personalEmail.nullable().optional(),
  personalMobile: z.string().trim().max(20).nullable().optional(),
  gender: z.enum(["Male", "Female", "Other"]).optional(),
  dateOfBirth: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
  dateOfJoining: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD"),
  salaryStartDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
  employmentType: z.string().trim().optional(),
  branchId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  processId: z.string().uuid().nullable().optional(),
  designationId: z.string().uuid().nullable().optional(),
  costCentreId: z.string().uuid({ message: 'Cost Centre is required' }),
  reportingManagerId: z.string().uuid().nullable().optional(),
  // Optional: auto-assign salary at creation
  structureId: z.string().uuid().optional(),
  ctcAnnual: z.number().positive().optional(),
  // Optional statutory info for dedup at creation time
  panNumber: z.string().trim().max(20).nullable().optional(),
  aadhaarNumber: z.string().trim().max(20).nullable().optional(),
});

export const updateEmployeeSchema = z.object({
  employeeCode: z.string().trim().min(1).max(50).optional(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().max(100).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  officialEmail: officialEmail.nullable().optional(),
  mobile: z.string().trim().max(20).nullable().optional(),
  personalEmail: personalEmail.nullable().optional(),
  personalMobile: z.string().trim().max(20).nullable().optional(),
  gender: z.enum(["Male", "Female", "Other"]).optional(),
  dateOfBirth: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
  dateOfJoining: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
  salaryStartDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").nullable().optional(),
  dateOfExit: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").nullable().optional(),
  employmentType: z.string().trim().optional(),
  employmentStatus: z.enum(["Active", "Inactive", "On Notice", "Onboarding"]).optional(),
  // Required by the service whenever this request actually deactivates someone.
  // Optional here because it is meaningless on every other kind of profile edit.
  deactivationReason: z.string().trim().max(500).optional(),
  branchId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  processId: z.string().uuid().nullable().optional(),
  costCentreId: z.string().uuid().nullable().optional(),
  designationId: z.string().uuid().nullable().optional(),
  reportingManagerId: z.string().uuid().nullable().optional(),
  designationName: z.string().trim().max(100).nullable().optional(),
  address1: z.string().trim().max(255).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  workingHoursStart: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/).nullable().optional(),
  workingHoursEnd: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/).nullable().optional(),
  workingDays: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
  photoUrl: z.string().trim().url().nullable().optional(),
  ctc: z.coerce.number().nonnegative().nullable().optional(),
  annualIncome: z.coerce.number().nonnegative().nullable().optional(),
  countOfDependents: z.coerce.number().int().nonnegative().nullable().optional(),
});

export const employeeFiltersSchema = z.object({
  status: z.string().optional(),
  // Defaults to "active", not "all": before recordStatus was honoured every caller got
  // active-only regardless, so "active" is what preserves existing behaviour. Defaulting to
  // "all" would silently start returning 57,517 inactive people to every employee picker.
  recordStatus: z.enum(["active", "inactive", "all"]).default("active"),
  processId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  designationId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  includeAnalytics: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  // Whitelisted against SORT_COLUMNS in employee.service.ts, not passed to SQL directly —
  // an enum here is belt-and-suspenders, the real gate is the whitelist lookup at the call site.
  sortBy: z.enum(["employeeCode", "name", "department", "process", "reportingManager", "designation", "joinDate", "status"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type EmployeeFilters = z.infer<typeof employeeFiltersSchema>;

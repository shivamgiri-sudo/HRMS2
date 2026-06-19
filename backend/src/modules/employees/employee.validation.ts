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
  reportingManagerId: z.string().uuid().nullable().optional(),
  // Optional: auto-assign salary at creation
  structureId: z.string().uuid().optional(),
  ctcAnnual: z.number().positive().optional(),
});

export const updateEmployeeSchema = z.object({
  employeeCode: z.string().trim().min(1).max(50).optional(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().max(100).nullable().optional(),
  email: officialEmail.nullable().optional(),
  mobile: z.string().trim().max(20).nullable().optional(),
  personalEmail: personalEmail.nullable().optional(),
  personalMobile: z.string().trim().max(20).nullable().optional(),
  gender: z.enum(["Male", "Female", "Other"]).optional(),
  dateOfBirth: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
  dateOfJoining: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
  salaryStartDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").nullable().optional(),
  dateOfExit: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").nullable().optional(),
  employmentType: z.string().trim().optional(),
  employmentStatus: z.enum(["Active", "Inactive", "On Notice", "Absconded", "Terminated", "Onboarding"]).optional(),
  branchId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  processId: z.string().uuid().nullable().optional(),
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
  userId: z.string().uuid().nullable().optional(),
  ctc: z.coerce.number().nonnegative().nullable().optional(),
});

export const employeeFiltersSchema = z.object({
  status: z.string().optional(),
  recordStatus: z.enum(["active", "inactive", "all"]).default("all"),
  processId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  includeAnalytics: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type EmployeeFilters = z.infer<typeof employeeFiltersSchema>;

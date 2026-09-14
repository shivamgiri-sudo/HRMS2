import { z } from "zod";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$|^\d{4}-Q[1-4]$/; // YYYY-MM or YYYY-Q1

// ================== Cycle Schemas ==================

export const createCycleSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  cycleType: z.enum(["Annual", "Quarterly", "Monthly", "Project-Based"]),
  startDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD"),
  endDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD"),
  period: z.string().regex(PERIOD_REGEX, "Period must be YYYY-MM or YYYY-Q1"),
  selfAssessmentDeadline: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD"),
  managerReviewDeadline: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD"),
  isPeakSeasonAllowanceApplicable: z.boolean().default(false),
});

export const updateCycleSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  cycleType: z.enum(["Annual", "Quarterly", "Monthly", "Project-Based"]).optional(),
  startDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
  endDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
  period: z.string().regex(PERIOD_REGEX, "Period must be YYYY-MM or YYYY-Q1").optional(),
  selfAssessmentDeadline: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
  managerReviewDeadline: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
  isPeakSeasonAllowanceApplicable: z.boolean().optional(),
  status: z.enum(["Draft", "Active", "Closed"]).optional(),
});

export const launchCycleSchema = z.object({
  employeeIds: z.array(z.string().uuid()).min(1, "At least one employee required"),
  processIds: z.array(z.string().uuid()).optional(),
  departmentIds: z.array(z.string().uuid()).optional(),
});

// ================== Feedback Schemas ==================

export const competencyRatingSchema = z.object({
  competencyId: z.string().uuid(),
  selfRating: z.number().int().min(1).max(5),
  selfComment: z.string().trim().max(1000).optional(),
  managerRating: z.number().int().min(1).max(5).optional(),
  managerComment: z.string().trim().max(1000).optional(),
});

export const kpiRatingSchema = z.object({
  kpiId: z.string().uuid(),
  selfRating: z.number().int().min(1).max(5),
  selfComment: z.string().trim().max(1000).optional(),
  managerRating: z.number().int().min(1).max(5).optional(),
  managerComment: z.string().trim().max(1000).optional(),
});

export const submitFeedbackSchema = z.object({
  employeeId: z.string().uuid(),
  cycleId: z.string().uuid(),
  overallSelfRating: z.number().int().min(1).max(5).optional(),
  overallManagerRating: z.number().int().min(1).max(5).optional(),
  managerFinalComment: z.string().trim().max(2000).optional(),
  competencies: z.array(competencyRatingSchema).optional(),
  kpis: z.array(kpiRatingSchema).optional(),
});

// ================== Competency Schemas ==================

export const createCompetencySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  category: z.enum(["Technical", "Behavioral", "Leadership"]),
  processIds: z.array(z.string().uuid()).optional(),
  designationIds: z.array(z.string().uuid()).optional(),
  weight: z.number().min(0).max(100).optional(),
});

export const updateCompetencySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  category: z.enum(["Technical", "Behavioral", "Leadership"]).optional(),
  processIds: z.array(z.string().uuid()).optional(),
  designationIds: z.array(z.string().uuid()).optional(),
  weight: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
});

// ================== Development Plan Schemas ==================

export const createDevelopmentPlanSchema = z.object({
  employeeId: z.string().uuid(),
  cycleId: z.string().uuid(),
  goals: z.array(
    z.object({
      area: z.string().trim().min(1).max(200),
      description: z.string().trim().max(1000),
      targetDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD"),
      status: z.enum(["Pending", "In Progress", "Completed", "Cancelled"]).default("Pending"),
    })
  ).min(1, "At least one goal required"),
});

export const updateDevelopmentPlanSchema = z.object({
  goals: z.array(
    z.object({
      id: z.string().uuid().optional(),
      area: z.string().trim().min(1).max(200).optional(),
      description: z.string().trim().max(1000).optional(),
      targetDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
      status: z.enum(["Pending", "In Progress", "Completed", "Cancelled"]).optional(),
    })
  ).optional(),
});

export const updateGoalSchema = z.object({
  area: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  targetDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
  status: z.enum(["Pending", "In Progress", "Completed", "Cancelled"]).optional(),
  completedDate: z.string().regex(DATE_REGEX, "Date must be YYYY-MM-DD").optional(),
});

// ================== Query/Filter Schemas ==================

export const cycleFiltersSchema = z.object({
  status: z.enum(["Draft", "Active", "Closed"]).optional(),
  cycleType: z.enum(["Annual", "Quarterly", "Monthly", "Project-Based"]).optional(),
  period: z.string().regex(PERIOD_REGEX, "Period must be YYYY-MM or YYYY-Q1").optional(),
});

export const feedbackFiltersSchema = z.object({
  cycleId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  status: z.enum(["Pending", "Self-Completed", "Manager-Completed"]).optional(),
});

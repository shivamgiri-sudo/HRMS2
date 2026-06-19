import { z } from "zod";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const createCandidateSchema = z.object({
  fullName:          z.string().trim().min(2).max(255),
  mobile:            z.string().trim().min(10).max(20),
  email:             z.string().email({ message: "Valid email required" }).nullable().optional(),
  gender:            z.enum(["Male", "Female", "Other"]).nullable().optional(),
  dateOfBirth:       z.string().regex(DATE_RE).nullable().optional(),
  education:         z.string().trim().min(1).max(255),
  experience:        z.string().trim().min(1).max(255),
  appliedForProcess: z.string().trim().min(1).max(255),
  appliedForBranch:  z.string().trim().min(1).max(255),
  appliedForRole:    z.string().trim().min(1).max(255).nullable().optional(),
  sourcingChannel:   z.string().trim().min(1).max(100),
  referredBy:        z.string().trim().max(255).nullable().optional(),
  walkInDate:        z.string().regex(DATE_RE).nullable().optional(),
  arrivalTime:       z.string().trim().max(10).nullable().optional(),
  remarks:           z.string().trim().nullable().optional(),
  address:           z.string().trim().max(2000).nullable().optional(),
  // Accept both string ("Yes"/"No") and number (1/0) for TINYINT(1) columns
  rotationalShift:   z.union([z.string().trim().max(50), z.number().int().min(0).max(1)]).nullable().optional(),
  preferredShift:    z.string().trim().max(100).nullable().optional(),
  nightShiftOk:      z.union([z.string().trim().max(50), z.number().int().min(0).max(1)]).nullable().optional(),
  leavesIn3months:   z.union([z.string().trim().max(50), z.number().int().min(0).max(1)]).nullable().optional(),
  ownsTwoWheeler:    z.union([z.string().trim().max(50), z.number().int().min(0).max(1)]).nullable().optional(),
  idProofAvailable:  z.union([z.string().trim().max(50), z.number().int().min(0).max(1)]).nullable().optional(),
  educationProofAvailable: z.union([z.string().trim().max(50), z.number().int().min(0).max(1)]).nullable().optional(),
  recruiterName:     z.string().trim().max(255).nullable().optional(),
  profileStatus:     z.string().trim().max(50).nullable().optional(),
});

export const updateCandidateSchema = createCandidateSchema
  .omit({ mobile: true })
  .partial();

export const moveStagingSchema = z.object({
  toStage: z.string().trim().min(1).max(100),
  remarks: z.string().trim().nullable().optional(),
});

export const candidateFiltersSchema = z.object({
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(200).default(50),
  stage:     z.string().optional(),
  branch:    z.string().optional(),
  process:   z.string().optional(),
  search:    z.string().optional(),
  fromDate:  z.string().regex(DATE_RE).optional(),
  toDate:    z.string().regex(DATE_RE).optional(),
});

export const createOnboardingBridgeSchema = z.object({
  candidateId:    z.string().uuid(),
  bridgeDate:     z.string().regex(DATE_RE),
  joiningDate:    z.string().regex(DATE_RE).nullable().optional(),
  offerLetterUrl: z.string().url().nullable().optional(),
  notes:          z.string().trim().nullable().optional(),
});

export const updateOnboardingBridgeSchema = z.object({
  employeeId:     z.string().uuid().nullable().optional(),
  joiningDate:    z.string().regex(DATE_RE).nullable().optional(),
  status:         z.enum(["pending", "joined", "no_show", "cancelled"]).optional(),
  offerLetterUrl: z.string().url().nullable().optional(),
  notes:          z.string().trim().nullable().optional(),
});

export type CreateCandidateInput  = z.infer<typeof createCandidateSchema>;
export type UpdateCandidateInput  = z.infer<typeof updateCandidateSchema>;
export type MoveStageInput        = z.infer<typeof moveStagingSchema>;
export type CandidateFilters      = z.infer<typeof candidateFiltersSchema>;
export type CreateBridgeInput     = z.infer<typeof createOnboardingBridgeSchema>;
export type UpdateBridgeInput     = z.infer<typeof updateOnboardingBridgeSchema>;

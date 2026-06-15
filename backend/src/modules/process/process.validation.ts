import { z } from "zod";

export const processFiltersSchema = z.object({
  search: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  activeStatus: z.enum(["all", "active", "inactive"]).optional().default("active")
});

export const createProcessSchema = z.object({
  processCode: z
    .string()
    .trim()
    .min(2, "Process code must be at least 2 characters")
    .max(80, "Process code is too long"),
  processName: z
    .string()
    .trim()
    .min(2, "Process name must be at least 2 characters")
    .max(180, "Process name is too long"),
  departmentId: z.string().uuid().nullable().optional(),
  processType: z.string().trim().max(80).nullable().optional(),
  branchName: z.string().trim().max(120).nullable().optional(),
  locationName: z.string().trim().max(120).nullable().optional(),
  processOwnerEmployeeId: z.string().uuid().nullable().optional(),
  processManagerEmployeeId: z.string().uuid().nullable().optional(),
  description: z.string().trim().nullable().optional()
});

export const updateProcessSchema = z.object({
  processName: z.string().trim().min(2).max(180).optional(),
  departmentId: z.string().uuid().nullable().optional(),
  processType: z.string().trim().max(80).nullable().optional(),
  branchName: z.string().trim().max(120).nullable().optional(),
  locationName: z.string().trim().max(120).nullable().optional(),
  processOwnerEmployeeId: z.string().uuid().nullable().optional(),
  processManagerEmployeeId: z.string().uuid().nullable().optional(),
  activeStatus: z.boolean().optional(),
  description: z.string().trim().nullable().optional()
});

export const updateProcessStatusSchema = z.object({
  activeStatus: z.boolean()
});

import { z } from 'zod';

// =============================================================================
// Customization Rule Validation
// =============================================================================

export const createRuleSchema = z.object({
  ruleName: z.string().min(1).max(100),
  entityType: z.string().min(1).max(50),
  entityId: z.string().uuid().optional(),

  // Dimension filters (arrays of UUIDs)
  branchIds: z.array(z.string().uuid()).optional(),
  processIds: z.array(z.string().uuid()).optional(),
  departmentIds: z.array(z.string().uuid()).optional(),
  designationIds: z.array(z.string().uuid()).optional(),
  roleIds: z.array(z.string().uuid()).optional(),
  employeeIds: z.array(z.string().uuid()).optional(),

  // Config
  configType: z.enum(['override', 'merge', 'extend', 'disable']),
  configData: z.record(z.any()),

  // Metadata
  priority: z.number().int().default(0),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const updateRuleSchema = createRuleSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const getRulesSchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  isActive: z.enum(['active', 'inactive', 'all']).optional().default('active'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const getEffectiveConfigSchema = z.object({
  employeeId: z.string().uuid(),
  entityType: z.string().min(1),
  entityId: z.string().uuid().optional(),
});

export const previewRuleSchema = z.object({
  ruleId: z.string().uuid(),
  employeeIds: z.array(z.string().uuid()).min(1),
});

export const bulkApplySchema = z.object({
  ruleId: z.string().uuid(),
  employeeIds: z.array(z.string().uuid()).min(1),
});

// Type exports
export type CreateRuleInput = z.infer<typeof createRuleSchema>;
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;
export type GetRulesFilters = z.infer<typeof getRulesSchema>;
export type GetEffectiveConfigInput = z.infer<typeof getEffectiveConfigSchema>;
export type PreviewRuleInput = z.infer<typeof previewRuleSchema>;
export type BulkApplyInput = z.infer<typeof bulkApplySchema>;

// backend/src/modules/compliance/maternity.validation.ts
import { z } from 'zod';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const createMaternitySchema = z.object({
  employee_id:             z.string().uuid(),
  record_type:             z.enum(['delivery', 'adoption', 'miscarriage', 'surrogacy']).default('delivery'),
  child_birth_order:       z.coerce.number().int().min(1).max(20).default(1),
  expected_delivery_date:  z.string().regex(DATE).nullable().optional(),
  leave_start_date:        z.string().regex(DATE, 'Date must be YYYY-MM-DD'),
  complications:           z.boolean().default(false),
  notes:                   z.string().trim().nullable().optional(),
});

export const updateMaternitySchema = z.object({
  status:                  z.enum(['applied', 'approved', 'active', 'completed', 'rejected']).optional(),
  actual_delivery_date:    z.string().regex(DATE).nullable().optional(),
  leave_end_date:          z.string().regex(DATE).nullable().optional(),
  nursing_break_granted:   z.boolean().optional(),
  work_from_home_option:   z.boolean().optional(),
  notes:                   z.string().trim().nullable().optional(),
});

export const maternityListFiltersSchema = z.object({
  status:      z.enum(['applied', 'approved', 'active', 'completed', 'rejected']).optional(),
  record_type: z.enum(['delivery', 'adoption', 'miscarriage', 'surrogacy']).optional(),
  year:        z.coerce.number().int().optional(),
});

export type CreateMaternityInput = z.infer<typeof createMaternitySchema>;
export type UpdateMaternityInput = z.infer<typeof updateMaternitySchema>;
export type MaternityListFilters = z.infer<typeof maternityListFiltersSchema>;

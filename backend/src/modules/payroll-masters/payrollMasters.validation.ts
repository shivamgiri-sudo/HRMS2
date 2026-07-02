import { z } from 'zod';

export const CreateSlabSchema = z.object({
  slab_code: z.string().min(1).max(50),
  range_from: z.coerce.number().min(0),
  range_to: z.coerce.number().min(1),
  label: z.string().min(1).max(100),
  seq_order: z.coerce.number().int().min(0).default(0),
  active_status: z.coerce.number().int().min(0).max(1).default(1),
});

export const UpdateSlabSchema = CreateSlabSchema.partial();

export const CreateBandSchema = z.object({
  band_code: z.string().min(1).max(20),
  band_name: z.string().min(1).max(100),
  slab_from: z.coerce.number().min(0),
  slab_to: z.coerce.number().min(0),
  active_status: z.coerce.number().int().min(0).max(1).default(1),
});

export const UpdateBandSchema = CreateBandSchema.partial();

const amtType = z.enum(['fixed', 'pct']).default('fixed');

export const CreatePackageSchema = z.object({
  grade_id: z.string().uuid(),
  slab_id: z.string().uuid(),
  location_id: z.string().uuid().nullable().optional(),
  cost_centre_id: z.string().uuid().nullable().optional(),
  basic_amt: z.coerce.number().min(0).default(0),
  conveyance_amt: z.coerce.number().min(0).default(0),
  conveyance_type: amtType,
  medical_amt: z.coerce.number().min(0).default(0),
  medical_type: amtType,
  other_allowance_amt: z.coerce.number().min(0).default(0),
  other_allowance_type: amtType,
  bonus_amt: z.coerce.number().min(0).default(0),
  bonus_type: amtType,
  portfolio_amt: z.coerce.number().min(0).default(0),
  special_allowance_amt: z.coerce.number().min(0).default(0),
  pli_amt: z.coerce.number().min(0).default(0),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const UpdatePackageSchema = CreatePackageSchema.partial();

export const CreateMatrixEntrySchema = z.object({
  department_id: z.string().uuid(),
  designation_id: z.string().uuid(),
  grade_id: z.string().uuid(),
  min_slab_id: z.string().uuid().nullable().optional(),
});

export const UpdateMatrixEntrySchema = CreateMatrixEntrySchema.partial();

export const BulkMatrixUpsertSchema = z.array(CreateMatrixEntrySchema).min(1).max(500);

export const CreateMinWageSchema = z.object({
  state_code: z.string().min(1).max(10),
  state_name: z.string().min(1).max(64),
  category: z.enum(['unskilled', 'semi_skilled', 'skilled', 'highly_skilled']),
  daily_rate: z.coerce.number().min(0),
  monthly_rate: z.coerce.number().min(0),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const UpdateMinWageSchema = CreateMinWageSchema.partial();

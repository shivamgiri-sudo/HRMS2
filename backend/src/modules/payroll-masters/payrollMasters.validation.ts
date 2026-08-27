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

const moneyField = z.coerce.number().min(0).default(0);

export const CreatePackageSchema = z.object({
  branch_name:       z.string().min(1),
  band_code:         z.string().min(1),
  cost_centre_code:  z.string().optional().nullable(),
  package_amount:    z.coerce.number().min(0),
  basic:             moneyField,
  hra:               moneyField,
  // lta was missing from this schema while being present in the service's
  // PACKAGE_MONEY_COLUMNS, so zod stripped it out of every payload and the INSERT
  // wrote 0 for it no matter what was submitted — a silent drop, not an error.
  // Dormant until now only because LTA is 0 on all 302 catalog rows; the admin
  // package form gained an LTA input on 2026-08-27, which would have made it live.
  lta:               moneyField,
  conveyance:        moneyField,
  portfolio:         moneyField,
  medical:           moneyField,
  special_allowance: moneyField,
  other_allowance:   moneyField,
  bonus:             moneyField,
  pli:               moneyField,
  gross:             moneyField,
  epf_employee:      moneyField,
  esic_employee:     moneyField,
  professional_tax:  moneyField,
  net_in_hand:       moneyField,
  epf_employer:      moneyField,
  esic_employer:     moneyField,
  admin_charges:     moneyField,
  ctc:               moneyField,
  active_status:     z.coerce.number().int().min(0).max(1).optional().default(1),
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

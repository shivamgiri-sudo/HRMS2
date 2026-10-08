import { z } from 'zod';

export const CreateIncentiveMasterSchema = z.object({
  incentive_code: z.string().min(1).max(50),
  incentive_name: z.string().min(1).max(255),
  description: z.string().max(1000).optional().nullable(),
  gl_code: z.string().max(50).optional().nullable(),
  taxable: z.coerce.number().int().min(0).max(1).default(1),
  pf_applicable: z.coerce.number().int().min(0).max(1).default(0),
  esic_applicable: z.coerce.number().int().min(0).max(1).default(0),
});

export const UpdateIncentiveMasterSchema = CreateIncentiveMasterSchema.partial();

export const CreateBatchSchema = z.object({
  incentive_id: z.string().uuid(),
  pay_month: z.string().regex(/^\d{4}-\d{2}$/, 'pay_month must be YYYY-MM'),
  remarks: z.string().max(500).optional().nullable(),
});

export const ImportLinesSchema = z.array(z.object({
  employee_code: z.string().min(1),
  amount: z.coerce.number().min(0),
  remarks: z.string().max(500).optional().nullable(),
})).min(1).max(5000);

export const ApproveRejectSchema = z.object({
  remarks: z.string().max(500).optional().nullable(),
});

export const ApplyToRunSchema = z.object({
  run_id: z.string().uuid(),
  pay_month: z.string().regex(/^\d{4}-\d{2}$/),
});

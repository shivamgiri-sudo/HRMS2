// =====================================================
// Company Feed Validation Schemas
// =====================================================

import { z } from 'zod';

export const CompanyPostStatusSchema = z.enum([
  'draft',
  'pending_approval',
  'borderline_flagged',
  'approved',
  'rejected',
  'auto_rejected',
  'deleted',
]);

export const CompanyPostModerationStateSchema = z.enum([
  'clean',
  'borderline',
  'violation',
  'manual_override_approved',
  'manual_override_rejected',
]);

export const CompanyPostMediaSchema = z.object({
  file_id: z.string().min(1, 'File ID is required'),
  media_type: z.literal('image'),
  sort_order: z.number().int().min(1).max(4),
}).strict();

export const CreateCompanyPostSchema = z.object({
  content_text: z.string().trim().max(5000).optional(),
  media: z.array(CompanyPostMediaSchema).max(4).default([]),
}).refine((data) => Boolean(data.content_text) || data.media.length > 0, {
  message: 'Post must contain text or at least one image',
  path: ['content_text'],
});

export const ModerateCompanyPostSchema = z.object({
  post_id: z.string().uuid('Invalid post ID'),
  actor_user_id: z.string().uuid('Invalid actor user ID').optional(),
  action: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(500).optional(),
  review_notes: z.string().trim().max(2000).optional(),
});

export const GrantCompanyPostCreatorSchema = z.object({
  employee_id: z.string().uuid('Invalid employee ID'),
  user_id: z.string().uuid('Invalid user ID').optional(),
});

export const RevokeCompanyPostCreatorSchema = z.object({
  employee_id: z.string().uuid('Invalid employee ID'),
});

export const DeleteCompanyPostSchema = z.object({
  post_id: z.string().uuid('Invalid post ID'),
  reason: z.string().trim().max(500).optional(),
});

export type CreateCompanyPostInput = z.infer<typeof CreateCompanyPostSchema>;
export type ModerateCompanyPostInput = z.infer<typeof ModerateCompanyPostSchema>;
export type GrantCompanyPostCreatorInput = z.infer<typeof GrantCompanyPostCreatorSchema>;
export type RevokeCompanyPostCreatorInput = z.infer<typeof RevokeCompanyPostCreatorSchema>;
export type DeleteCompanyPostInput = z.infer<typeof DeleteCompanyPostSchema>;

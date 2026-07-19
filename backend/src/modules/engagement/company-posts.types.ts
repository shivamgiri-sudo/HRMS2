// =====================================================
// Company Feed Domain Types
// =====================================================

export type CompanyPostStatus =
  | 'draft'
  | 'pending_approval'
  | 'borderline_flagged'
  | 'approved'
  | 'rejected'
  | 'auto_rejected'
  | 'deleted';

export type CompanyPostModerationState =
  | 'clean'
  | 'borderline'
  | 'violation'
  | 'manual_override_approved'
  | 'manual_override_rejected';

export type CompanyPostMediaType = 'image';

export interface CompanyPostMediaDTO {
  id?: string;
  file_id: string;
  media_type: CompanyPostMediaType;
  sort_order: number;
  moderation_state?: CompanyPostModerationState;
  moderation_reason?: string | null;
}

export interface CreateCompanyPostMediaDTO {
  file_id: string;
  media_type: CompanyPostMediaType;
  sort_order: number;
}

export interface CompanyPostDTO {
  id: string;
  author_user_id: string;
  author_employee_id: string;
  author_name: string | null;
  author_code: string | null;
  content_text: string | null;
  status: CompanyPostStatus;
  moderation_state: CompanyPostModerationState;
  moderation_score: number | null;
  auto_reject_reason: string | null;
  review_notes: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  rejected_by_name: string | null;
  rejection_reason: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  active_status: boolean;
  created_at: string;
  updated_at: string;
  media: CompanyPostMediaDTO[];
}

export interface CreateCompanyPostDTO {
  content_text?: string;
  media?: CreateCompanyPostMediaDTO[];
}

export interface CompanyPostFeedItemDTO extends Pick<
  CompanyPostDTO,
  'id' | 'content_text' | 'status' | 'created_at' | 'updated_at'
> {
  author_user_id: string;
  author_employee_id: string;
  author_name: string | null;
  author_code: string | null;
  media: CompanyPostMediaDTO[];
}

export interface CompanyPostListResult {
  posts: CompanyPostDTO[];
  total: number;
  page: number;
  limit: number;
}

export interface CompanyPostCreatorAccessRowDTO {
  id: string;
  employee_id: string;
  user_id: string;
  active_status: boolean;
  granted_by: string | null;
  granted_at: string;
  revoked_by: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  employee_name: string | null;
  employee_code: string | null;
  department: string | null;
}

export interface ModerateCompanyPostDTO {
  post_id: string;
  actor_user_id?: string;
  action: 'approve' | 'reject';
  reason?: string;
  review_notes?: string;
}

export interface GrantCompanyPostCreatorDTO {
  employee_id: string;
  user_id?: string;
}

export interface RevokeCompanyPostCreatorDTO {
  employee_id: string;
}

export type CreateCompanyPostInput = CreateCompanyPostDTO;
export type ModerateCompanyPostInput = ModerateCompanyPostDTO;
export type CreatorAccessGrantInput = GrantCompanyPostCreatorDTO;
export type CreatorAccessRevokeInput = RevokeCompanyPostCreatorDTO;

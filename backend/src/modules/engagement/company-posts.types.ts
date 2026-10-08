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

// festival-greeting.cron.ts has written 'festival' into post_type since it was built —
// missing here meant the INSERT's own literal was never checked against this union.
export type CompanyPostType = 'user' | 'birthday' | 'anniversary' | 'festival';

export interface CompanyPostDTO {
  id: string;
  author_user_id: string;
  author_employee_id: string | null;
  author_name: string | null;
  author_code: string | null;
  content_text: string | null;
  post_type: CompanyPostType;
  is_system_post: boolean;
  celebrated_employee_id: string | null;
  // The person a birthday/anniversary post is actually about. Never selected before —
  // the feed had no way to show that employee's real name or photo at all, only whatever
  // could be parsed back out of the generated message text.
  celebrated_employee_name: string | null;
  celebrated_employee_code: string | null;
  celebrated_employee_avatar: string | null;
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
  like_count: number;
  dislike_count: number;
  comment_count: number;
  my_reaction: 'like' | 'dislike' | null;
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
  'id' | 'content_text' | 'status' | 'post_type' | 'is_system_post' | 'created_at' | 'updated_at'
> {
  author_user_id: string;
  author_employee_id: string | null;
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

export interface CommentDTO {
  id: string;
  post_id: string;
  user_id: string;
  author_name: string | null;
  author_code: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface CommentListResult {
  comments: CommentDTO[];
  total: number;
}

export type CreateCompanyPostInput = CreateCompanyPostDTO;
export type ModerateCompanyPostInput = ModerateCompanyPostDTO;
export type CreatorAccessGrantInput = GrantCompanyPostCreatorDTO;
export type CreatorAccessRevokeInput = RevokeCompanyPostCreatorDTO;

/**
 * IJP Module Types
 * Internal Job Posting system for cross-functional transfers and promotions
 */

export type IjpPostingStatus = 'draft' | 'open' | 'closed' | 'filled' | 'cancelled';

export type IjpApplicationStatus =
  | 'submitted'
  | 'pending_manager'
  | 'manager_approved'
  | 'manager_rejected'
  | 'under_review'
  | 'shortlisted'
  | 'interview_scheduled'
  | 'selected'
  | 'rejected'
  | 'withdrawn'
  | 'offer_extended'
  | 'offer_accepted'
  | 'offer_declined';

export interface IjpPosting {
  id: string;
  posting_code: string;
  job_title: string;
  description: string | null;

  // Target position
  department_id: string | null;
  process_id: string | null;
  designation_id: string | null;
  branch_id: string | null;
  vacancies: number;

  // Eligibility criteria
  min_tenure_months: number;
  eligible_employment_status: string[];
  eligible_department_ids: string[] | null;
  eligible_process_ids: string[] | null;
  excluded_process_ids: string[] | null;
  eligible_designation_ids: string[] | null;
  eligible_branch_ids: string[] | null;
  min_performance_rating: number | null;
  require_manager_approval: boolean;

  // Lifecycle
  status: IjpPostingStatus;
  posted_by: string;
  posted_at: string | null;
  closes_at: string | null;
  closed_at: string | null;
  close_reason: string | null;

  created_at: string;
  updated_at: string;
}

export interface IjpPostingWithDetails extends IjpPosting {
  department_name: string | null;
  process_name: string | null;
  designation_name: string | null;
  branch_name: string | null;
  posted_by_name: string | null;
  application_count: number;
}

export interface IjpApplication {
  id: string;
  posting_id: string;
  employee_id: string;
  application_note: string | null;

  // Position snapshot
  current_department_id: string | null;
  current_process_id: string | null;
  current_designation_id: string | null;
  current_branch_id: string | null;
  tenure_months: number | null;

  // Workflow
  status: IjpApplicationStatus;
  manager_id: string | null;
  manager_action_at: string | null;
  manager_remarks: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_remarks: string | null;
  interview_scheduled_at: string | null;
  interview_remarks: string | null;
  selected_at: string | null;
  selection_remarks: string | null;
  offer_details: Record<string, unknown> | null;

  applied_at: string;
  updated_at: string;
}

export interface IjpApplicationWithDetails extends IjpApplication {
  employee_code: string;
  employee_name: string;
  employee_email: string | null;
  employee_mobile: string | null;
  current_department_name: string | null;
  current_process_name: string | null;
  current_designation_name: string | null;
  current_branch_name: string | null;
  manager_name: string | null;
  reviewer_name: string | null;
  posting_code: string;
  job_title: string;
}

export interface EligibilityCheckResult {
  eligible: boolean;
  reasons: string[];
  tenure_months: number;
  employment_status: string;
}

export interface CreatePostingInput {
  job_title: string;
  description?: string;
  department_id?: string;
  process_id?: string;
  designation_id?: string;
  branch_id?: string;
  vacancies?: number;
  min_tenure_months?: number;
  eligible_employment_status?: string[];
  eligible_department_ids?: string[];
  eligible_process_ids?: string[];
  excluded_process_ids?: string[];
  eligible_designation_ids?: string[];
  eligible_branch_ids?: string[];
  min_performance_rating?: number;
  require_manager_approval?: boolean;
  closes_at?: string;
}

export interface UpdatePostingInput extends Partial<CreatePostingInput> {
  status?: IjpPostingStatus;
  close_reason?: string;
}

export interface ApplyInput {
  application_note?: string;
}

export interface UpdateApplicationStatusInput {
  status: IjpApplicationStatus;
  remarks?: string;
  interview_scheduled_at?: string;
  offer_details?: Record<string, unknown>;
}

export interface IjpAuditLog {
  id: string;
  posting_id: string | null;
  application_id: string | null;
  action: string;
  actor_id: string;
  actor_role: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

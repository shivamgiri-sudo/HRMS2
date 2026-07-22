/**
 * Job Requisition Types
 * Stage 1 of HRMS Journey: Workforce Requirement and Job Requisition
 */

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern' | 'trainee';
export type RequisitionPriority = 'low' | 'normal' | 'high' | 'urgent';
export type RequisitionType = 'new_position' | 'replacement' | 'expansion' | 'seasonal' | 'project_based';
export type ApprovalStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'cancelled' | 'on_hold' | 'closed';
export type CandidateOutcome = 'in_progress' | 'selected' | 'rejected' | 'withdrawn' | 'offer_declined';

export interface JobRequisition {
  id: string;
  requisition_code: string;
  designation_id: string | null;
  designation_name: string;
  department_id: string | null;
  department_name: string | null;
  branch_id: string | null;
  branch_name: string;
  process_id: string | null;
  process_name: string | null;
  requested_headcount: number;
  fulfilled_headcount: number;
  employment_type: EmploymentType;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  experience_min_years: number | null;
  experience_max_years: number | null;
  education_requirement: string | null;
  skills_required: string | null;
  job_description: string | null;
  shift_requirement: string | null;
  rotational_shift: boolean;
  night_shift_required: boolean;
  target_joining_date: string | null;
  requisition_validity: string | null;
  priority: RequisitionPriority;
  requisition_type: RequisitionType;
  business_justification: string | null;
  approval_status: ApprovalStatus;
  approval_request_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  requested_by: string;
  requested_by_name: string | null;
  owner_recruiter_id: string | null;
  preferred_sources: string[] | null;
  internal_posting: boolean;
  active_status: boolean;
  closed_at: string | null;
  closed_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobRequisitionSummary extends JobRequisition {
  open_positions: number;
  owner_recruiter_name: string | null;
  aging_days: number;
  derived_status: string;
  total_candidates: number;
  selected_candidates: number;
  pipeline_candidates: number;
}

export interface CreateRequisitionInput {
  designation_id?: string;
  designation_name: string;
  department_id?: string;
  department_name?: string;
  branch_id?: string;
  branch_name: string;
  process_id?: string;
  process_name?: string;
  requested_headcount: number;
  employment_type?: EmploymentType;
  salary_min?: number;
  salary_max?: number;
  experience_min_years?: number;
  experience_max_years?: number;
  education_requirement?: string;
  skills_required?: string;
  job_description?: string;
  shift_requirement?: string;
  rotational_shift?: boolean;
  night_shift_required?: boolean;
  target_joining_date?: string;
  requisition_validity?: string;
  priority?: RequisitionPriority;
  requisition_type?: RequisitionType;
  business_justification?: string;
  preferred_sources?: string[];
  internal_posting?: boolean;
}

export interface UpdateRequisitionInput extends Partial<CreateRequisitionInput> {
  owner_recruiter_id?: string;
}

export interface RequisitionFilters {
  branch_id?: string;
  branch_name?: string;
  process_id?: string;
  department_id?: string;
  approval_status?: ApprovalStatus;
  priority?: RequisitionPriority;
  employment_type?: EmploymentType;
  requested_by?: string;
  owner_recruiter_id?: string;
  from_date?: string;
  to_date?: string;
  search?: string;
  include_closed?: boolean;
  page?: number;
  limit?: number;
}

export interface RequisitionCandidate {
  id: string;
  requisition_id: string;
  candidate_id: string;
  linked_at: string;
  linked_by: string | null;
  link_source: 'manual' | 'auto_match' | 'candidate_applied';
  current_stage: string | null;
  outcome: CandidateOutcome | null;
  outcome_at: string | null;
  remarks: string | null;
}

export interface RequisitionApprovalLog {
  id: string;
  requisition_id: string;
  approval_step: number;
  action: 'submitted' | 'approved' | 'rejected' | 'returned' | 'escalated' | 'cancelled';
  actor_id: string;
  actor_name: string | null;
  actor_role: string | null;
  remarks: string | null;
  action_at: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface RequisitionDashboardMetrics {
  total_requisitions: number;
  open_requisitions: number;
  pending_approval: number;
  approved_active: number;
  total_open_positions: number;
  total_fulfilled: number;
  fill_rate_percent: number;
  avg_time_to_fill_days: number;
  by_priority: Record<RequisitionPriority, number>;
  by_branch: Array<{ branch_name: string; count: number; open_positions: number }>;
  by_status: Record<ApprovalStatus, number>;
}

export interface RequisitionFunnel {
  requisition_id: string;
  requisition_code: string;
  designation_name: string;
  branch_name: string;
  process_name: string | null;
  requested_headcount: number;
  fulfilled_headcount: number;
  planned_batch_no: string | null;
  planned_batch_name: string | null;
  training_start_date: string | null;
  approval_status: ApprovalStatus;
  demand_raised_date: string;
  demand_approved_date: string | null;
  business_justification: string | null;
  funnel: {
    total_linked: number;
    walkin_count: number;
    screened_count: number;
    selected_count: number;
    offered_count: number;
    onboarding_count: number;
    joined_count: number;
    lms_enrolled_count: number;
  };
}

export interface LmsBatchOption {
  batch_no: string;
  batch_name: string;
  batch_status: string;
  branch: string | null;
  process: string | null;
  lob: string | null;
  start_date: string | null;
  end_date: string | null;
  expected_trainees: number;
  current_trainees: number;
}

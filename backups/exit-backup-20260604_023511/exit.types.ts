export interface ExitRequest {
  id: string;
  employee_id: string;
  initiated_by: string;
  initiated_by_user_id: string | null;
  exit_type: string;
  exit_sub_type: string;
  exit_reason_category: string | null;
  resignation_reason: string | null;
  last_working_day_proposed: string | null;
  last_working_day_confirmed: string | null;
  notice_period_days: number;
  notice_start_date: string | null;
  notice_end_date: string | null;
  status: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  revoked_by: string | null;
  submitted_at: string | null;
  manager_actioned_at: string | null;
  hr_actioned_at: string | null;
  admin_actioned_at: string | null;
  exit_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExitApprovalLog {
  id: string;
  exit_request_id: string;
  stage: string;
  action: string;
  action_by: string;
  action_by_role: string | null;
  discussion_remarks: string | null;
  internal_notes: string | null;
  created_at: string;
}

export interface ExitClearanceChecklist {
  id: string;
  exit_request_id: string;
  department: string;
  assigned_to: string | null;
  status: string;
  remarks: string | null;
  cleared_at: string | null;
  created_at: string;
}

export interface AttritionSnapshot {
  id: string;
  snapshot_month: string;
  branch_id: string | null;
  process_id: string | null;
  opening_headcount: number;
  closing_headcount: number;
  voluntary_exits: number;
  involuntary_exits: number;
  total_exits: number;
  new_joiners: number;
  attrition_rate: number;
  computed_at: string;
}

export interface ExitStats {
  draft: number;
  submitted: number;
  manager_review: number;
  hr_review: number;
  admin_review: number;
  accepted: number;
  rejected: number;
  revoked: number;
  notice_serving: number;
  exited: number;
  total: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

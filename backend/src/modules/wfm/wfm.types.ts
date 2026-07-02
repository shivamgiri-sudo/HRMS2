export interface WfmShift {
  id: string;
  shift_code: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  required_minutes: number;
  branch_name: string | null;
  process_name: string | null;
  active_status: number;
  created_at: string;
  updated_at: string;
}

export interface WfmRosterPlan {
  id: string;
  plan_name: string;
  process_id: string | null;
  branch_id: string | null;
  shift_id: string | null;
  from_date: string;
  to_date: string;
  required_headcount: number;
  assigned_headcount: number;
  plan_status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WfmRosterAssignment {
  id: string;
  employee_id: string;
  shift_id: string | null;
  plan_id: string | null;
  roster_date: string;
  roster_status: string;
  shift_start_time: string | null;
  shift_end_time: string | null;
  branch_name: string | null;
  process_name: string | null;
  publish_status: string;
  created_at: string;
  updated_at: string;
}

export interface WfmAttendanceSession {
  id: string;
  employee_id: string;
  roster_assignment_id: string | null;
  session_date: string;
  login_time: string | null;
  logout_time: string | null;
  total_login_minutes: number;
  current_status: string;
  punch_source: string;
  branch_name: string | null;
  process_name: string | null;
  regularization_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WfmBreakLog {
  id: string;
  session_id: string;
  employee_id: string;
  break_start: string;
  break_end: string | null;
  duration_minutes: number;
  break_type: string;
  punch_source: string;
  created_at: string;
}

export interface AttendanceRegularization {
  id: string;
  employee_id: string;
  session_date: string;
  requested_status: 'present' | 'half_day' | 'absent' | null;
  reason: string;
  reason_code: string | null;
  requested_by_type: 'employee' | 'manager';
  branch_id: string | null;
  supporting_note: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_note: string | null;
  applied_to_session_id: string | null;
  created_at: string;
  updated_at: string;
  // JOINed fields (present in list queries)
  employee_name?: string;
  employee_code?: string;
  reason_label?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ShiftListFilters { activeStatus?: "active" | "inactive" | "all"; }
export interface RegularizationListFilters { employeeId?: string; status?: string; }

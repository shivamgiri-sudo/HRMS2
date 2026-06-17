export interface LeaveType {
  id: string;
  leave_code: string;
  leave_name: string;
  max_days_per_year: number;
  carry_forward: number;
  requires_approval: number;
  paid_leave: number;
  active_status: number;
  created_at: string;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type_id: string;
  from_date: string;
  to_date: string;
  total_days: number;
  reason: string | null;
  status: string;
  applied_at: string;
  created_at: string;
}

export interface LeaveBalanceLedger {
  id: string;
  employee_id: string;
  leave_type_id: string;
  balance_year: number;
  allocated_days: number;
  used_days: number;
  adjusted_days: number;
  updated_at: string;
}

export interface LeaveHoliday {
  id: string;
  holiday_name: string;
  holiday_date: string;
  holiday_type: string;
  branch_id: string | null;
  active_status: number;
  created_at: string;
}

export interface LeavePolicyConfig {
  id: string;
  leave_type_id: string;
  monthly_credit_days: number;
  annual_credit_days: number;
  credit_on_jan_first: number;
  max_days_per_month: number;
  max_occurrences_per_year: number;
  max_days_per_occurrence: number;
  exception_approver_role: string | null;
  pool_with: string | null;
  created_at: string;
}

export interface LeaveElCreditLog {
  id: string;
  employee_id: string;
  leave_type_id: string;
  credit_year: number;
  credit_month: number | null;
  credit_date: string;
  days_credited: number;
  months_served: number;
  credit_type: 'annual' | 'monthly' | 'manual';
  created_at: string;
}

export interface LeaveElAccrualLedger {
  id: string;
  employee_id: string;
  accrual_year: number;
  accrued_days: number;
  last_credited_month: number;
  updated_at: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useEffect, useRef, useState } from "react";

export function useDebounce<T>(value: T, ms = 350): T {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value), ms);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, ms]);

  return debounced;
}

export interface HubEmployee {
  id: string;
  employee_code: string;
  full_name: string;
  employment_status: string;
  date_of_joining: string;
  branch_name: string | null;
  process_name: string | null;
  designation_name: string | null;
  dept_name: string | null;
  present_days: number;
  lwp_days: number;
  late_marks: number;
  missing_punch_count: number;
  has_anomaly: boolean;
  last_salary_net: number | null;
  last_salary_month: string | null;
}

export interface HubFilters {
  search: string;
  branchId: string;
  processId: string;
  designationId: string;
  status: string;
  anomalyOnly: boolean;
  page: number;
  limit: number;
}

export interface DailyRecord {
  date: string;
  status: string;
  clock_in: string | null;
  clock_out: string | null;
  raw_minutes: number | null;
  location: string | null;
  source: string | null;
}

export interface AttendanceSummary {
  presentDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  holidayDays: number;
  weekOffDays: number;
  totalLwp: number;
  lateMarks: number;
  totalWorkingDays: number;
  totalHours: number;
  wfoDays: number;
  attendancePct: number;
}

export interface RunningSalary {
  earned_payable_days: number;
  eligible_weekoff_till_date: number;
  eligible_holiday_till_date: number;
  earned_salary_till_date: number;
  earned_net_till_date: number;
  projected_payable_days: number;
  projected_salary: number;
  projected_net: number;
  pf_employee: number;
  esic_employee: number;
  professional_tax: number;
}

export interface PayslipSummary {
  run_id: string;
  run_month: string;
  gross_salary: number;
  net_salary: number;
  total_deductions: number;
  status: string;
  paid_at: string | null;
  run_status: string;
}

export interface PayslipComponent {
  component_code: string;
  component_name: string;
  component_type: "earning" | "deduction";
  amount: number;
  taxable: number;
}

export interface PayslipDetail extends PayslipSummary {
  basic: number;
  hra: number;
  special_allowance: number;
  pf_employee: number;
  esic_employee: number;
  professional_tax: number;
  tds: number;
  lwp_deduction: number;
  advance_recovery: number;
  paid_working_days: number;
  eligible_weekoff_days: number;
  eligible_holiday_days: number;
  final_payable_days: number;
  active_calendar_days: number;
  components: PayslipComponent[];
}

export interface RegularizationRecord {
  id: string;
  session_date: string;
  request_category: string;
  old_status: string | null;
  requested_status: string | null;
  reason: string;
  status: string;
  submitted_at: string;
  manager_reviewed_at: string | null;
  reviewed_at: string | null;
}

export interface LeaveBalance {
  leave_type_id: string;
  leave_type_name: string;
  allocated_days: number;
  used_days: number;
  adjusted_days: number;
  balance: number;
}

export interface SelectOption {
  id: string;
  name: string;
}

export interface AttendanceHubFilterOptions {
  branches: SelectOption[];
  processes: SelectOption[];
  designations: SelectOption[];
  statuses: SelectOption[];
}

export interface TodaySummary {
  date: string;
  total_active: number;
  present: number;
  half_day: number;
  absent: number;
  missing_punch: number;
  on_leave: number;
  week_off: number;
  holiday: number;
}

// ── Directory ──────────────────────────────────────────────────────────────

export function useHubEmployees(filters: HubFilters, month: string) {
  const params = new URLSearchParams({ month, page: String(filters.page), limit: String(filters.limit) });
  if (filters.search)        params.set("search", filters.search);
  if (filters.branchId)      params.set("branchId", filters.branchId);
  if (filters.processId)     params.set("processId", filters.processId);
  if (filters.designationId) params.set("designationId", filters.designationId);
  if (filters.status)        params.set("status", filters.status);
  if (filters.anomalyOnly)   params.set("anomalyOnly", "1");

  return useQuery({
    queryKey: ["hub-employees", filters, month],
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/employees/hr-hub?${params}`);
      const raw: HubEmployee[] = Array.isArray(res) ? res : (res?.data ?? []);
      return { data: raw, total: Number(res?.total ?? raw.length) };
    },
    staleTime: 60_000,
  });
}

// ── Attendance ─────────────────────────────────────────────────────────────

export function useAttendanceDailyRecords(employeeId: string | null, fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ["attendance-daily", employeeId, fromDate, toDate],
    enabled: !!employeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/wfm/attendance/daily?employeeId=${employeeId}&fromDate=${fromDate}&toDate=${toDate}`);
      return (res?.data ?? res ?? []) as DailyRecord[];
    },
    staleTime: 30_000,
  });
}

export function useAttendanceSummary(employeeId: string | null, month: string) {
  return useQuery({
    queryKey: ["attendance-summary", employeeId, month],
    enabled: !!employeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/wfm/attendance/summary/${employeeId}/${month}`);
      return (res?.data ?? res) as AttendanceSummary;
    },
    staleTime: 30_000,
  });
}

// ── Salary ─────────────────────────────────────────────────────────────────

export function useRunningSalary(employeeId: string | null, month: string) {
  return useQuery({
    queryKey: ["running-salary", employeeId, month],
    enabled: !!employeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/payroll/running-summary/${employeeId}?month=${month}`);
      return (res?.data ?? res?.summary ?? res) as RunningSalary;
    },
    staleTime: 60_000,
  });
}

export function usePayslipHistory(employeeId: string | null) {
  return useQuery({
    queryKey: ["payslip-history", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/payroll/payslip/history/${employeeId}?limit=24`);
      return (res?.data ?? res ?? []) as PayslipSummary[];
    },
    staleTime: 120_000,
  });
}

export function usePayslipDetail(runId: string | null, employeeId: string | null) {
  return useQuery({
    queryKey: ["payslip-detail", runId, employeeId],
    enabled: !!runId && !!employeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/payroll/payslip/${runId}/${employeeId}`);
      return (res?.data ?? res) as PayslipDetail;
    },
    staleTime: 300_000,
  });
}

// ── Regularizations ────────────────────────────────────────────────────────

export function useRegularizationHistory(employeeId: string | null) {
  return useQuery({
    queryKey: ["regularization-history", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/wfm/regularizations?employeeId=${employeeId}&limit=50`);
      return (res?.data ?? res ?? []) as RegularizationRecord[];
    },
    staleTime: 60_000,
  });
}

// ── Leave ──────────────────────────────────────────────────────────────────

export function useLeaveBalance(employeeId: string | null, year: number) {
  return useQuery({
    queryKey: ["leave-balance", employeeId, year],
    enabled: !!employeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/leave/balance/${employeeId}?year=${year}`);
      return (res?.data ?? res ?? []) as LeaveBalance[];
    },
    staleTime: 120_000,
  });
}

export function useTodaySummary() {
  return useQuery({
    queryKey: ["hub-today-summary"],
    queryFn: async () => {
      const res = await hrmsApi.get<any>("/api/employees/hr-hub/today-summary");
      return (res?.data ?? res) as TodaySummary;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

// ── Master lists for filter dropdowns ─────────────────────────────────────

export function useAttendanceHubFilterOptions(
  branchId: string,
  processId: string,
  designationId: string,
) {
  const params = new URLSearchParams();
  if (branchId) params.set("branchId", branchId);
  if (processId) params.set("processId", processId);
  if (designationId) params.set("designationId", designationId);

  return useQuery({
    queryKey: ["attendance-hub-filter-options", branchId, processId, designationId],
    queryFn: async () => {
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      const res = await hrmsApi.get<any>(`/api/employees/hr-hub/filter-options${suffix}`);
      const data = (res?.data ?? res ?? {}) as Partial<AttendanceHubFilterOptions>;
      return {
        branches: data.branches ?? [],
        processes: data.processes ?? [],
        designations: data.designations ?? [],
        statuses: data.statuses ?? [],
      } satisfies AttendanceHubFilterOptions;
    },
    staleTime: 300_000,
    placeholderData: (previous) => previous,
  });
}

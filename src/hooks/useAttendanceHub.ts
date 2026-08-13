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
  /**
   * Worked minutes less that day's kiosk-tracked break time (break-management module,
   * 2026-07+), floored at 0. Falls back to raw_minutes on any day with no break-kiosk
   * row (the vast majority historically — the feature is new and coverage is still
   * sparse), which is the correct default: no measured break, no deduction.
   */
  net_minutes: number | null;
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
  /**
   * Gross worked hours for the month — MTD (capped at today) when `month` is the
   * current calendar month, full-month total otherwise. See the backend's WHERE
   * clause (wfm.routes.ts, GET /attendance/summary/:employeeId/:month) for the exact
   * cap logic; this field is already MTD by construction, no client-side capping needed.
   */
  totalHours: number;
  /** Hours beyond 480 min (8h) worked in a single day, summed over the same MTD window as totalHours. */
  otHours: number;
  /**
   * totalHours less kiosk-tracked break time, floored per day before summing. Equals
   * totalHours for any employee/month with no break-kiosk data (sparse historical
   * coverage, 2026-07+ feature) — that's the correct default, not a gap.
   */
  netHours: number;
  wfoDays: number;
  attendancePct: number;
}

export interface RunningSalary {
  earned_payable_days: number;
  eligible_weekoff_till_date: number;
  eligible_holiday_till_date: number;
  lwp_till_date?: number;
  earned_salary_till_date: number;
  earned_net_till_date: number;
  projected_payable_days: number;
  projected_salary: number;
  projected_net: number;
  pf_employee: number;
  esic_employee: number;
  professional_tax: number;
  esic_applicable?: boolean;
  gross_monthly?: number;
  /**
   * Only present once the month is finalized: the running estimate always
   * computes with tds = 0, but the stored salary_prep_line the backend
   * substitutes after lock carries a real TDS figure.
   */
  tds?: number;
  /** True when the backend returned a stored calculated line rather than a live estimate. */
  is_finalized?: boolean;
  /** True when the run is still in draft/processing — calculated but not yet locked. */
  is_draft?: boolean;

  /**
   * APR provenance — present only for employees the attendance engine judges on
   * the dialler feed (Operations Executives).
   *
   * These split the SAME earned figure; they never change it. `apr_verified_*`
   * plus `fallback_*` add back to `earned_salary_till_date` exactly. A day is
   * unverified when the employee had no APR row and the engine classified them
   * on their biometric punch instead — which is what payroll will pay, but is
   * not evidence from the source their designation is configured against.
   *
   * Null (and `apr_eligible: false`) for everyone else, and for finalized months.
   */
  apr_eligible?: boolean;
  apr_verified_payable_days?: number | null;
  apr_verified_salary_till_date?: number | null;
  fallback_payable_days?: number | null;
  fallback_salary_till_date?: number | null;
  /** Days where neither APR nor a punch had anything — held at lwp 0.00 pending WFM. */
  apr_no_data_days?: number | null;
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
  reason?: string;
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
  /**
   * LWP as a DAY COUNT (salary_prep_line.lwp_days) — distinct from
   * `lwp_deduction` above, which is the rupee amount. The API has always
   * returned this (payslip.service.ts selects spl.lwp_days); it was simply
   * missing from this interface, so the payslip attendance grid failed to
   * typecheck. Optional to match the backend's `lwp_days?: number`.
   */
  lwp_days?: number | null;
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
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  // refetchOnWindowFocus overrides the app-wide default (false in App.tsx) for
  // this operational query only — the underlying data changes (a new punch,
  // a leave approval, a salary run) independently of anything the user does
  // here, so returning to the tab should re-check rather than show what was
  // last fetched. Scoped per-query rather than flipping the global default,
  // which would touch every one of the ~170 other useQuery call sites.
    refetchOnWindowFocus: true,
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
    staleTime: 0,
  // refetchOnWindowFocus overrides the app-wide default (false in App.tsx) for
  // this operational query only — the underlying data changes (a new punch,
  // a leave approval, a salary run) independently of anything the user does
  // here, so returning to the tab should re-check rather than show what was
  // last fetched. Scoped per-query rather than flipping the global default,
  // which would touch every one of the ~170 other useQuery call sites.
    refetchOnWindowFocus: true,
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
    staleTime: 0,
  // refetchOnWindowFocus overrides the app-wide default (false in App.tsx) for
  // this operational query only — the underlying data changes (a new punch,
  // a leave approval, a salary run) independently of anything the user does
  // here, so returning to the tab should re-check rather than show what was
  // last fetched. Scoped per-query rather than flipping the global default,
  // which would touch every one of the ~170 other useQuery call sites.
    refetchOnWindowFocus: true,
  });
}

// ── Salary ─────────────────────────────────────────────────────────────────

/**
 * Running-month salary for one employee.
 *
 * `self` picks the self-service endpoint, which resolves the employee from the
 * JWT. Employees must use it — `/running-summary/:employeeId` is role-gated to
 * payroll/HR/management and 403s for them. Both routes run the same
 * computeRunningSalary() engine and apply the same finalized-line override, so
 * the returned figures are identical; only the authorization differs.
 */
export function useRunningSalary(
  employeeId: string | null,
  month: string,
  opts: { self?: boolean } = {},
) {
  const self = opts.self === true;
  return useQuery({
    queryKey: ["running-salary", self ? "me" : (employeeId ?? "none"), month],
    // The self route needs no employeeId — the backend reads it from the token.
    enabled: self || !!employeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(
        self
          ? `/api/payroll/running-summary/me?month=${month}`
          : `/api/payroll/running-summary/${employeeId}?month=${month}`
      );
      return (res?.data ?? res?.summary ?? res) as RunningSalary;
    },
    staleTime: 0,
  // refetchOnWindowFocus overrides the app-wide default (false in App.tsx) for
  // this operational query only — the underlying data changes (a new punch,
  // a leave approval, a salary run) independently of anything the user does
  // here, so returning to the tab should re-check rather than show what was
  // last fetched. Scoped per-query rather than flipping the global default,
  // which would touch every one of the ~170 other useQuery call sites.
    refetchOnWindowFocus: true,
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
    // staleTime: 0 — salary_prep_line is recalculated during any open run (COSEC
    // sync, regularization approval, manual drift recalc). A 2-minute window means
    // a recalculation that just fixed 30 paid days still shows 29 to anyone who
    // opened the tab in the last 2 minutes. Payslip history is cheap to refetch.
    staleTime: 0,
    refetchOnWindowFocus: true,
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
    // staleTime: 0 — salary_prep_line changes on every recalculation during a
    // processing run. A 5-minute stale window means recalculated values (paid days,
    // net salary) show stale data to anyone with the detail expanded. Disbursed
    // runs never change, so this is safe to refetch aggressively.
    staleTime: 0,
    refetchOnWindowFocus: true,
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
  // refetchOnWindowFocus overrides the app-wide default (false in App.tsx) for
  // this operational query only — the underlying data changes (a new punch,
  // a leave approval, a salary run) independently of anything the user does
  // here, so returning to the tab should re-check rather than show what was
  // last fetched. Scoped per-query rather than flipping the global default,
  // which would touch every one of the ~170 other useQuery call sites.
    refetchOnWindowFocus: true,
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
  // refetchOnWindowFocus overrides the app-wide default (false in App.tsx) for
  // this operational query only — the underlying data changes (a new punch,
  // a leave approval, a salary run) independently of anything the user does
  // here, so returning to the tab should re-check rather than show what was
  // last fetched. Scoped per-query rather than flipping the global default,
  // which would touch every one of the ~170 other useQuery call sites.
    refetchOnWindowFocus: true,
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
  // refetchOnWindowFocus overrides the app-wide default (false in App.tsx) for
  // this operational query only — the underlying data changes (a new punch,
  // a leave approval, a salary run) independently of anything the user does
  // here, so returning to the tab should re-check rather than show what was
  // last fetched. Scoped per-query rather than flipping the global default,
  // which would touch every one of the ~170 other useQuery call sites.
    refetchOnWindowFocus: true,
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

import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * The manager's team, a whole month, plus the salary days payroll will actually pay.
 *
 * Two requests, deliberately not one. The grid comes from the attendance engine's
 * records; the salary-days figure comes from computeRunningSalary via
 * /api/payroll/running-summary-batch — the same function behind the salary card on
 * every other screen. Merging them server-side would have meant a second payable-days
 * formula living in the attendance module, and a grid that quietly disagrees with the
 * payslip is worse than a grid with a blank column.
 */

export interface TeamMonthDay {
  d: string;
  /** False for days before joining, after exit, or in the future — never a gap. */
  applicable: boolean;
  hasRecord?: boolean;
  status?: string | null;
  lwp?: number;
  regularized?: boolean;
  overridden?: boolean;
  locked?: boolean;
  needsAttention?: boolean;
  /** APR and biometric disagreed. Informational — not a blocker and not an action. */
  sourceMismatch?: boolean;
  source?: string | null;
  sourceSystem?: string | null;
  minutes?: number;
  lateMark?: boolean;
  lateBy?: number;
  clockIn?: string | null;
  clockOut?: string | null;
  note?: string | null;
  pendingRegularizationId?: string | null;
}

export interface TeamMonthEmployee {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation: string | null;
  department: string | null;
  process: string | null;
  branch: string | null;
  counts: { needsAttention: number; absent: number; regularized: number; missing: number };
  days: TeamMonthDay[];
  /** Merged in from payroll. Undefined means payroll could not answer — not zero. */
  salaryDays?: number;
}

export interface TeamMonthResponse {
  month: string;
  days: number;
  employees: TeamMonthEmployee[];
  summary: {
    employees: number;
    needs_attention: number;
    absent: number;
    regularized: number;
    missing: number;
  };
  /** True when the salary-days column could not be populated at all. */
  salaryDaysUnavailable: boolean;
}

interface Filters {
  branchId?: string;
  processId?: string;
  search?: string;
}

export function useTeamAttendanceMonth(month: string, filters: Filters = {}) {
  return useQuery<TeamMonthResponse>({
    queryKey: ["team-attendance-month", month, filters.branchId ?? "", filters.processId ?? "", filters.search ?? ""],
    enabled: Boolean(month),
    staleTime: 30_000,
    queryFn: async () => {
      const qs = new URLSearchParams({ month });
      if (filters.branchId) qs.set("branchId", filters.branchId);
      if (filters.processId) qs.set("processId", filters.processId);
      if (filters.search) qs.set("search", filters.search);

      const grid = await hrmsApi.get<any>(`/api/wfm/attendance/team-month?${qs.toString()}`);
      const employees: TeamMonthEmployee[] = grid?.employees ?? [];

      // Salary days are additive context, so a failure here must not blank the grid.
      // The column simply shows nothing rather than a number the page invented.
      let salaryDaysUnavailable = false;
      try {
        const batch = await hrmsApi.get<any>(
          `/api/payroll/running-summary-batch?month=${encodeURIComponent(month)}&limit=200`,
        );
        const rows: any[] = batch?.data ?? batch?.employees ?? [];
        const byId = new Map<string, number>();
        for (const r of rows) {
          const id = String(r.employee_id ?? r.employeeId ?? "");
          const days = r.earned_payable_days ?? r.final_payable_days;
          if (id && days !== undefined && days !== null) byId.set(id, Number(days));
        }
        if (byId.size === 0) salaryDaysUnavailable = true;
        for (const emp of employees) {
          const v = byId.get(emp.employeeId);
          if (v !== undefined) emp.salaryDays = v;
        }
      } catch {
        salaryDaysUnavailable = true;
      }

      return {
        month: grid?.month ?? month,
        days: Number(grid?.days ?? 31),
        employees,
        summary: grid?.summary ?? { employees: 0, needs_attention: 0, absent: 0, regularized: 0, missing: 0 },
        salaryDaysUnavailable,
      };
    },
  });
}

/** Current payroll month as YYYY-MM in IST, matching the rest of the product. */
export function currentIstMonth(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit",
  }).format(new Date()).slice(0, 7);
}

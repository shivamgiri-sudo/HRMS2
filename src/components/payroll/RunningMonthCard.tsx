import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useRunningSalary } from "@/hooks/useAttendanceHub";
import { formatLastSynced } from "@/lib/utils";

/**
 * The single running-month salary card.
 *
 * Every surface that shows mid-month earned salary renders THIS component —
 * Attendance Hub (Salary tab), Running Payroll Breakdown and the employee
 * Payslip viewer. Before this existed, each page rendered its own subset of the
 * same API payload with its own month derivation and its own visibility rules,
 * so the three disagreed about both the number and when to show it.
 *
 * All figures are earned-till-date. Projection fields are deliberately not
 * rendered: `projected_*` assumes every remaining calendar day is worked, which
 * reads as a promise of pay rather than an estimate. The API still returns them.
 */

const INR = (v: number | null | undefined) =>
  `₹${Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Current payroll month as YYYY-MM.
 *
 * Payroll months are IST months. Deriving this from the browser's local clock
 * showed the wrong month to anyone outside IST around the month boundary,
 * which made the running-month salary look inconsistent with Payroll.
 */
export function getIstRunMonth(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit",
  }).format(new Date()).slice(0, 7);
}

interface RunningMonthCardProps {
  /** Employee to show. May be null while the caller is still resolving it. */
  employeeId: string | null;
  /** YYYY-MM. Defaults to the current IST payroll month. */
  month?: string;
  /**
   * Read via the self-service endpoint. Required for employees: the
   * `/running-summary/:employeeId` route is role-gated and 403s for them.
   */
  self?: boolean;
  /**
   * Wraps every currency amount before rendering. Used by the payslip page to
   * apply its blur / "View salary" masking. Defaults to rendering as-is.
   */
  renderAmount?: (value: ReactNode) => ReactNode;
}

export function RunningMonthCard({
  employeeId,
  month,
  self = false,
  renderAmount,
}: RunningMonthCardProps) {
  const runMonth = month ?? getIstRunMonth();
  const { data: rs, isLoading, isError, error, refetch, dataUpdatedAt } =
    useRunningSalary(employeeId, runMonth, { self });
  const amount = renderAmount ?? ((value: ReactNode) => value);

  if (isLoading) return <Skeleton className="h-40 rounded-2xl" />;

  // A failure must not read as "this employee earned nothing". The per-employee
  // endpoint authorizes a narrower set of roles than either page that renders
  // this card gates on (wfm and payroll_admin reach the pages but get 403), so
  // a denial here is a live possibility, not a theoretical one.
  if (isError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-6 text-center">
        <p className="text-sm font-semibold text-rose-800">Running salary could not be loaded.</p>
        <p className="mt-1 text-xs text-rose-700">
          {(error as Error)?.message || "The running salary request failed."}
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-3 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!rs) return <div className="rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-500">No running salary data for {runMonth}.</div>;

  return (
    <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-white via-white to-[#e8f2fc] p-5 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Running Month Earned</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{amount(INR(rs.earned_salary_till_date))}</p>
          <p className="text-xs text-slate-500 mt-0.5">Net (after deductions): <span className="font-semibold text-slate-800">{amount(INR(rs.earned_net_till_date))}</span></p>
          {dataUpdatedAt > 0 && (
            <p className="text-[10px] text-slate-400 mt-1">
              Live estimate · {formatLastSynced(dataUpdatedAt)}
            </p>
          )}
        </div>
        <div className="rounded-xl bg-[#e8f2fc] px-3 py-1.5 text-xs font-semibold text-[#1B6AB5]">
          {runMonth}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3 text-center border-t border-indigo-100 pt-4">
        {[
          { label: "Payable Days", value: rs.earned_payable_days },
          { label: "Eligible Weekoffs", value: rs.eligible_weekoff_till_date },
          { label: "Eligible Holidays", value: rs.eligible_holiday_till_date },
          { label: "LWP (MTD)", value: rs.lwp_till_date ?? 0 },
        ].map(item => (
          <div key={item.label}>
            <p className="text-base font-bold text-slate-800">{item.value}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 text-center border-t border-indigo-100 pt-3 mt-3">
        <div>
          <p className="text-sm font-semibold text-slate-700">{amount(INR(rs.pf_employee))}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">PF (Employee)</p>
        </div>
        <div>
          {rs.esic_applicable === false ? (
            <p className="text-xs font-medium text-slate-400 italic">Not applicable</p>
          ) : (
            <p className="text-sm font-semibold text-slate-700">{amount(INR(rs.esic_employee))}</p>
          )}
          <p className="text-[10px] text-slate-500 mt-0.5">
            ESIC{rs.esic_applicable === false ? " (above ceiling)" : ""}
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-700">{amount(INR(rs.professional_tax))}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Prof. Tax</p>
        </div>
      </div>
    </div>
  );
}

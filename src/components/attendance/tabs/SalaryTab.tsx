import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { usePayslipHistory, usePayslipDetail } from "@/hooks/useAttendanceHub";
import type { PayslipSummary } from "@/hooks/useAttendanceHub";
import { RunningMonthCard } from "@/components/payroll/RunningMonthCard";

const INR = (v: number | null | undefined) =>
  `₹${Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Deduction heads that already have their own tile above, so they must not also
 * appear under "Other Deductions". This previously listed `ADV_REC`, but the real
 * component_code is `ADV` — advance recovery was therefore shown twice on every
 * payslip that had one. Every other head falls through to Other Deductions by
 * design, so a new head is never silently hidden.
 */
const TILED_DEDUCTIONS = new Set(["PF_EMP", "ESIC_EMP", "PT", "TDS", "LWP", "ADV"]);

function PayslipRow({ line, employeeId }: { line: PayslipSummary; employeeId: string }) {
  const [open, setOpen] = useState(false);
  const {
    data: detail,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = usePayslipDetail(open ? line.run_id : null, employeeId);

  const [yr, mo] = (line.run_month ?? "").split("-").map(Number);
  const monthLabel = MONTH_NAMES[mo] ? `${MONTH_NAMES[mo]} ${yr}` : line.run_month;

  const isPaid = line.run_status === "disbursed" || !!line.paid_at;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Summary row */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <p className="text-sm font-semibold text-slate-800">{monthLabel}</p>
            {isPaid && line.paid_at && (
              <p className="text-[10px] text-slate-400">Paid {line.paid_at.slice(0, 10)}</p>
            )}
          </div>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isPaid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            {isPaid ? "Paid" : (line.run_status ?? "—")}
          </span>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] text-slate-400">Gross</p>
            <p className="text-sm font-semibold text-slate-800">{INR(line.gross_salary)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-400">Deductions</p>
            <p className="text-sm font-semibold text-rose-600">{INR(line.total_deductions)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-400">Net Pay</p>
            <p className="text-sm font-bold text-slate-900">{INR(line.net_salary)}</p>
          </div>
          {open ? <ChevronUp className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />}
        </div>
      </button>

      {/* Expanded breakdown */}
      {open && (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-4">
          {isLoading || isFetching ? (
            <div className="flex items-center justify-center py-6 gap-2 text-slate-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading breakdown…
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center gap-3 py-5 text-center">
              <p className="text-sm font-medium text-rose-700">Could not load this payslip breakdown.</p>
              <p className="max-w-md text-xs text-slate-500">
                {(error as Error)?.message || "The payroll detail request failed."}
              </p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Retry breakdown
              </button>
            </div>
          ) : detail ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Attendance summary */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Attendance for Pay Month</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "Paid Days", value: detail.paid_working_days },
                    { label: "Weekoffs", value: detail.eligible_weekoff_days },
                    { label: "Holidays", value: detail.eligible_holiday_days },
                    { label: "LWP", value: detail.lwp_days },
                    { label: "Payable", value: detail.final_payable_days },
                    { label: "Calendar Days", value: detail.active_calendar_days },
                  ].map(item => (
                    <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-2">
                      <p className="text-sm font-bold text-slate-800">{item.value ?? "—"}</p>
                      <p className="text-[9px] text-slate-400">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Earnings */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Earnings</p>
                <div className="space-y-1">
                  {(detail.components ?? [])
                    .filter(c => c.component_type === "earning" && Number(c.amount) > 0)
                    .map(c => (
                      <div key={c.component_code} className="flex justify-between items-start text-xs gap-2">
                        <span className="text-slate-600">
                          <span>{c.component_name}</span>
                          {c.reason && <span className="block text-[10px] text-slate-400 italic mt-0.5">↳ {c.reason}</span>}
                        </span>
                        <span className="font-medium text-slate-800 shrink-0">{INR(Number(c.amount))}</span>
                      </div>
                    ))}
                  {(detail.components ?? []).filter(c => c.component_type === "earning" && Number(c.amount) > 0).length === 0 && (
                    <>
                      {detail.basic > 0           && <div className="flex justify-between text-xs"><span className="text-slate-600">Basic Salary</span><span className="font-medium text-slate-800">{INR(detail.basic)}</span></div>}
                      {detail.hra > 0             && <div className="flex justify-between text-xs"><span className="text-slate-600">HRA</span><span className="font-medium text-slate-800">{INR(detail.hra)}</span></div>}
                      {detail.special_allowance > 0 && <div className="flex justify-between text-xs"><span className="text-slate-600">Special Allowance</span><span className="font-medium text-slate-800">{INR(detail.special_allowance)}</span></div>}
                    </>
                  )}
                  <div className="flex justify-between text-xs font-semibold border-t border-slate-200 pt-1 mt-1">
                    <span className="text-slate-700">Gross Salary</span>
                    <span className="text-slate-900">{INR(detail.gross_salary)}</span>
                  </div>
                </div>
              </div>

              {/* Deductions */}
              <div className="sm:col-span-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Deductions</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: "PF (Employee)", value: detail.pf_employee },
                    { label: "ESIC", value: detail.esic_employee },
                    { label: "Prof. Tax", value: detail.professional_tax },
                    { label: "TDS", value: detail.tds },
                    { label: "LWP Deduction", value: detail.lwp_deduction },
                    { label: "Advance Recovery", value: detail.advance_recovery },
                  ]
                    // Only heads actually deducted. `!= null` also passed 0, so a
                    // payslip showed "₹0 TDS" tiles beside real deductions.
                    .filter(d => Number(d.value ?? 0) > 0)
                    .map(d => (
                      <div key={d.label} className="rounded-lg border border-slate-200 bg-white p-2.5">
                        <p className="text-sm font-bold text-rose-600">{INR(d.value)}</p>
                        <p className="text-[9px] text-slate-500 mt-0.5">{d.label}</p>
                      </div>
                    ))}
                </div>
                {/* Other Deductions (misc, with reasons) */}
                {(detail.components ?? [])
                  .filter(c =>
                    c.component_type === "deduction" &&
                    Number(c.amount) > 0 &&
                    !TILED_DEDUCTIONS.has(c.component_code.toUpperCase())
                  ).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-[9px] text-slate-400 uppercase font-semibold mb-2">Other Deductions</p>
                    <div className="space-y-1">
                      {(detail.components ?? [])
                        .filter(c =>
                          c.component_type === "deduction" &&
                          Number(c.amount) > 0 &&
                          !TILED_DEDUCTIONS.has(c.component_code.toUpperCase())
                        )
                        .map(c => (
                          <div key={c.component_code} className="flex justify-between items-start text-xs gap-2">
                            <span className="text-slate-600">
                              <span>{c.component_name}</span>
                              {c.reason && <span className="block text-[10px] text-slate-400 italic mt-0.5">↳ {c.reason}</span>}
                            </span>
                            <span className="font-medium text-rose-600 shrink-0">{INR(Number(c.amount))}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
                {/* Employer contributions — paid by the company, not deducted from
                    the employee. component_type 'employer_cost' reached no screen
                    before this, so employer PF, employer ESI and EPF admin charges
                    were invisible even though they are part of CTC. */}
                {(detail.components ?? []).filter(c => c.component_type === "employer_cost" && Number(c.amount) > 0).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-[9px] text-violet-500 uppercase font-semibold mb-2">
                      Employer Contributions <span className="text-slate-400 normal-case font-normal">· not deducted from your pay</span>
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(detail.components ?? [])
                        .filter(c => c.component_type === "employer_cost" && Number(c.amount) > 0)
                        .map(c => (
                          <div key={c.component_code} className="rounded-lg border border-violet-200 bg-violet-50/60 p-2.5">
                            <p className="text-sm font-bold text-violet-700">{INR(Number(c.amount))}</p>
                            <p className="text-[9px] text-slate-500 mt-0.5">{c.component_name}</p>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-between text-sm font-bold border-t border-slate-200 pt-2 mt-3 px-1">
                  <span className="text-slate-700">Net Pay</span>
                  <span className="text-slate-950">{INR(detail.net_salary)}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500 text-center">Could not load payslip details.</p>
          )}
        </div>
      )}
    </div>
  );
}

interface Props { employeeId: string; }

export function SalaryTab({ employeeId }: Props) {
  const {
    data: history = [],
    isLoading,
    isError,
    error,
    refetch,
  } = usePayslipHistory(employeeId);

  return (
    <div className="space-y-4">
      {/* Running month */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">Running Month</p>
        <RunningMonthCard employeeId={employeeId} />
      </div>

      {/* Past payslips */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">Past Payslips — click to expand full breakdown</p>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
          </div>
        ) : isError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-6 text-center">
            <p className="text-sm font-semibold text-rose-800">Payslip history could not be loaded.</p>
            <p className="mt-1 text-xs text-rose-700">
              {(error as Error)?.message || "The payroll history request failed."}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
            >
              Retry history
            </button>
          </div>
        ) : history.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500">
            No payslip history available.
          </div>
        ) : (
          <div className="space-y-2">
            {history.map(line => (
              <PayslipRow key={line.run_id} line={line} employeeId={employeeId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

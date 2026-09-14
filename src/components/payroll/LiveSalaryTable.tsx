import { ChevronLeft, ChevronRight, User } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Same row-as-button grid pattern as AttendanceHubTable.tsx (avatar-initial circle,
 * matching header/row grid-template, selected-row highlight, skeleton loading, dashed
 * empty state, prev/next pagination) — the Current Payroll live-salary lookup is meant
 * to feel like the same product as the Attendance lookup page, not a bespoke table.
 */

export interface LiveSalaryRow {
  employee_id: string;
  employee_code: string;
  name: string;
  branch_name?: string | null;
  process_name?: string | null;
  designation_name?: string | null;
  // computeRunningSalary shape
  earned_payable_days?: number;
  projected_payable_days?: number;
  earned_net_till_date?: number;
  projected_net?: number;
  // finalized-line fallback shape (rare for a running month, but the endpoint can return it)
  final_payable_days?: number;
  net_salary?: number;
  error?: boolean;
}

interface Props {
  employees: LiveSalaryRow[];
  total: number;
  page: number;
  limit: number;
  isLoading: boolean;
  onPageChange: (p: number) => void;
  onSelect: (emp: LiveSalaryRow) => void;
  selectedId: string | null;
}

const fmt = (n: number | undefined | null) =>
  n === undefined || n === null
    ? "—"
    : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const GRID = "grid-cols-[2fr_1fr_1fr_0.8fr_1fr_1fr]";

export function LiveSalaryTable({ employees, total, page, limit, isLoading, onPageChange, onSelect, selectedId }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!employees.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 py-16 gap-3 text-center">
        <User className="h-8 w-8 text-slate-300" />
        <p className="text-sm text-slate-500">No employees match the current filters.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className={`grid ${GRID} gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400`}>
        <span>Employee</span>
        <span>Branch / Process</span>
        <span>Designation</span>
        <span>Days so far</span>
        <span>Earned so far</span>
        <span>Projected</span>
      </div>

      {employees.map((emp) => {
        const isSelected = selectedId === emp.employee_id;
        return (
          <button
            key={emp.employee_id}
            type="button"
            onClick={() => onSelect(emp)}
            className={`w-full text-left grid ${GRID} gap-3 items-center px-4 py-3 rounded-xl border transition-all duration-150 ${
              isSelected
                ? "border-emerald-300 bg-emerald-50 shadow-sm"
                : "border-slate-200 bg-white hover:border-emerald-200 hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 text-sm font-semibold">
                {(emp.name || "?").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{emp.name || emp.employee_code}</p>
                <p className="text-xs text-slate-400 font-mono">{emp.employee_code}</p>
              </div>
            </div>

            <div className="min-w-0">
              <p className="text-xs text-slate-700 truncate">{emp.branch_name ?? "—"}</p>
              <p className="text-[10px] text-slate-400 truncate">{emp.process_name ?? "—"}</p>
            </div>

            <p className="text-xs text-slate-600 truncate">{emp.designation_name ?? "—"}</p>

            <p className="text-sm font-semibold text-slate-800 tabular-nums">
              {emp.earned_payable_days ?? emp.final_payable_days ?? "—"}
            </p>

            <p className="text-sm font-semibold text-slate-800 tabular-nums">
              {fmt(emp.earned_net_till_date ?? emp.net_salary)}
            </p>

            <p className="text-sm text-slate-600 tabular-nums">
              {emp.projected_net !== undefined ? fmt(emp.projected_net) : "—"}
            </p>
          </button>
        );
      })}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 px-1">
          <p className="text-xs text-slate-500">{total} employees</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-slate-600 font-medium">{page} / {totalPages}</span>
            <button
              type="button"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

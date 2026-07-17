import { ChevronLeft, ChevronRight, AlertTriangle, User } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { HubEmployee } from "@/hooks/useAttendanceHub";

const INR = (v: number | null | undefined) =>
  v != null ? `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—";

const STATUS_COLORS: Record<string, string> = {
  active:      "bg-emerald-50 text-emerald-700 border-emerald-200",
  inactive:    "bg-slate-100 text-slate-600 border-slate-200",
  "on notice": "bg-amber-50 text-amber-700 border-amber-200",
  onboarding:  "bg-blue-50 text-blue-700 border-blue-200",
};

interface Props {
  employees: HubEmployee[];
  total: number;
  page: number;
  limit: number;
  isLoading: boolean;
  month: string;
  onPageChange: (p: number) => void;
  onSelect: (emp: HubEmployee) => void;
  selectedId: string | null;
}

export function AttendanceHubTable({
  employees, total, page, limit, isLoading, month,
  onPageChange, onSelect, selectedId,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const [y, m] = month.split("-");
  const monthLabel = new Date(Number(y), Number(m) - 1).toLocaleString("en-IN", { month: "short", year: "numeric" });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
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
      {/* Table header */}
      <div className="grid grid-cols-[2fr_1fr_1fr_repeat(3,_0.8fr)_1fr_0.6fr] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        <span>Employee</span>
        <span>Branch / Process</span>
        <span>Designation</span>
        <span>{monthLabel} Present</span>
        <span>LWP</span>
        <span>Late</span>
        <span>Last Salary</span>
        <span></span>
      </div>

      {/* Rows */}
      {employees.map(emp => {
        const statusKey = (emp.employment_status ?? "").toLowerCase();
        const statusCls = STATUS_COLORS[statusKey] ?? STATUS_COLORS.inactive;
        const isSelected = selectedId === emp.id;

        return (
          <button
            key={emp.id}
            type="button"
            onClick={() => onSelect(emp)}
            className={`w-full text-left grid grid-cols-[2fr_1fr_1fr_repeat(3,_0.8fr)_1fr_0.6fr] gap-3 items-center px-4 py-3 rounded-xl border transition-all duration-150 ${
              isSelected
                ? "border-indigo-300 bg-indigo-50 shadow-sm"
                : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50"
            }`}
          >
            {/* Employee name + code */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 text-sm font-semibold">
                {(emp.full_name || "?").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{emp.full_name || "—"}</p>
                <p className="text-xs text-slate-400 font-mono">{emp.employee_code}</p>
              </div>
              {emp.has_anomaly && (
                <AlertTriangle className="h-3.5 w-3.5 text-rose-500 shrink-0" title="Attendance anomaly" />
              )}
            </div>

            {/* Branch / Process */}
            <div className="min-w-0">
              <p className="text-xs text-slate-700 truncate">{emp.branch_name ?? "—"}</p>
              <p className="text-[10px] text-slate-400 truncate">{emp.process_name ?? "—"}</p>
            </div>

            {/* Designation */}
            <p className="text-xs text-slate-600 truncate">{emp.designation_name ?? "—"}</p>

            {/* Present days */}
            <p className="text-sm font-semibold text-slate-800">{emp.present_days}</p>

            {/* LWP */}
            <p className={`text-sm font-semibold ${Number(emp.lwp_days) > 2 ? "text-rose-600" : "text-slate-700"}`}>
              {Number(emp.lwp_days).toFixed(1)}
            </p>

            {/* Late marks */}
            <p className={`text-sm font-semibold ${Number(emp.late_marks) > 3 ? "text-amber-600" : "text-slate-700"}`}>
              {emp.late_marks}
            </p>

            {/* Last salary */}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-800">{INR(emp.last_salary_net)}</p>
              {emp.last_salary_month && (
                <p className="text-[10px] text-slate-400">{emp.last_salary_month}</p>
              )}
            </div>

            {/* Status badge */}
            <Badge className={`text-[10px] capitalize border ${statusCls} hover:${statusCls}`}>
              {statusKey || "—"}
            </Badge>
          </button>
        );
      })}

      {/* Pagination */}
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
            <span className="text-xs text-slate-600 font-medium">
              {page} / {totalPages}
            </span>
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

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, Calendar, ChevronRight, AlertTriangle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";

interface PendingProcess {
  branch_id: string;
  process_id: string;
  branch_name: string;
  process_name: string;
  readiness_score: number;
  readiness_status: "not_started" | "in_progress" | "blocked";
}

interface PendingCountResponse {
  success: boolean;
  count: number;
  processes: PendingProcess[];
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

export function PayrollPrepWidget({ month }: { month: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["wfm-pending-processes", month],
    queryFn: () =>
      hrmsApi.get<PendingCountResponse>(
        `/api/payroll/process-readiness/my-pending-count?month=${month}`
      ),
    staleTime: 5 * 60_000,
    retry: false,
    throwOnError: false,
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2 animate-pulse">
        <div className="h-4 w-40 bg-slate-100 rounded" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-slate-50 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!data || data.count === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-emerald-800">
            All processes ready for {monthLabel(month)}
          </p>
          <p className="text-xs text-emerald-600 mt-0.5">
            Payroll Head can now process your data
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 bg-amber-50 px-4 py-3 border-b border-amber-100">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-amber-600" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
            Payroll Prep · {monthLabel(month)}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700">
          <AlertTriangle className="h-3 w-3" />
          {data.count} pending
        </span>
      </div>

      {/* Process rows */}
      <div className="divide-y divide-slate-100">
        {data.processes.map((proc) => (
          <Link
            key={proc.process_id}
            to={`/payroll/process-readiness?open=${proc.process_id}`}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800 leading-tight truncate">
                {proc.branch_name} / {proc.process_name}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-slate-100 max-w-[80px]">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      proc.readiness_score >= 80
                        ? "bg-emerald-400"
                        : proc.readiness_score >= 50
                        ? "bg-amber-400"
                        : "bg-red-400"
                    )}
                    style={{ width: `${proc.readiness_score}%` }}
                  />
                </div>
                <span className="text-[11px] text-slate-500 tabular-nums">
                  {proc.readiness_score}%
                </span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold border",
                    proc.readiness_status === "blocked"
                      ? "bg-red-50 text-red-700 border-red-200"
                      : proc.readiness_status === "in_progress"
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-slate-50 text-slate-500 border-slate-200"
                  )}
                >
                  {proc.readiness_status.replace("_", " ")}
                </span>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
          </Link>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-slate-100 bg-slate-50">
        <Link
          to="/payroll/process-readiness"
          className="text-xs font-semibold text-blue-600 hover:text-blue-800"
        >
          View all processes →
        </Link>
      </div>
    </div>
  );
}

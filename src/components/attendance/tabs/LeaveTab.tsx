import { Skeleton } from "@/components/ui/skeleton";
import { useLeaveBalance } from "@/hooks/useAttendanceHub";

interface Props { employeeId: string; }

export function LeaveTab({ employeeId }: Props) {
  const year = new Date().getFullYear();
  const { data: balances = [], isLoading } = useLeaveBalance(employeeId, year);

  if (isLoading) return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
    </div>
  );

  if (!balances.length) return (
    <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-500">
      No leave balance data found for {year}.
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">Leave Balances — {year}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {balances.map(b => {
          const remaining = Number(b.allocated_days) + Number(b.adjusted_days) - Number(b.used_days);
          const pct = b.allocated_days > 0 ? Math.min(100, (remaining / b.allocated_days) * 100) : 0;
          return (
            <div key={b.leave_type_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 truncate">{b.leave_type_name}</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{Math.max(0, remaining).toFixed(1)}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">remaining of {b.allocated_days} allocated</p>
              {/* Progress bar */}
              <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1.5 text-[10px] text-slate-400">Used: {Number(b.used_days).toFixed(1)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

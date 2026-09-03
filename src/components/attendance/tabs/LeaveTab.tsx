import { useState } from "react";
import { Undo2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLeaveBalance, useEmployeeLeaveRequests } from "@/hooks/useAttendanceHub";
import { useCanDiscard } from "@/hooks/useDiscard";
import { DiscardDialog } from "@/components/discard/DiscardDialog";

const LEAVE_STATUS_COLORS: Record<string, string> = {
  pending:              "bg-amber-50 text-amber-700",
  pending_branch_head:  "bg-amber-50 text-amber-700",
  approved:             "bg-emerald-50 text-emerald-700",
  rejected:             "bg-rose-50 text-rose-700",
  cancelled:            "bg-slate-100 text-slate-600",
  discarded:            "bg-slate-100 text-slate-500 line-through",
};

interface Props { employeeId: string; }

export function LeaveTab({ employeeId }: Props) {
  const year = new Date().getFullYear();
  const { data: balances = [], isLoading } = useLeaveBalance(employeeId, year);
  const { data: requests = [], isLoading: requestsLoading, refetch: refetchRequests } =
    useEmployeeLeaveRequests(employeeId, year);
  const { canDiscard } = useCanDiscard();
  const [discardLeaveId, setDiscardLeaveId] = useState<string | null>(null);

  if (isLoading) return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
    </div>
  );

  if (!balances.length && !requests.length) return (
    <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-500">
      No leave balance or leave requests found for {year}.
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

      {/* Leave requests — the rows a balance is made of, and the only place a wrongly
          approved leave can be reversed from this page. */}
      <div className="space-y-2 pt-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">Leave Requests — {year}</p>
        {requestsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}
          </div>
        ) : requests.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
            No leave requests in {year}.
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3 text-left">From</th>
                  <th className="px-4 py-3 text-left">To</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Days</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  {canDiscard && <th className="px-4 py-3 text-right">Action</th>}
                </tr>
              </thead>
              <tbody>
                {requests.map((r: any) => {
                  const statusCls = LEAVE_STATUS_COLORS[String(r.status)] ?? "bg-slate-100 text-slate-600";
                  return (
                    <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{String(r.from_date ?? "").slice(0, 10)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{String(r.to_date ?? "").slice(0, 10)}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{r.leave_type_name ?? r.leave_code ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{Number(r.total_days ?? r.days ?? 0).toFixed(1)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusCls}`}>
                          {String(r.status ?? "—").replace(/_/g, " ")}
                        </span>
                      </td>
                      {canDiscard && (
                        <td className="px-4 py-2.5 text-right">
                          {/* Only an approved leave has days to credit back and attendance to
                              restore. Anything else never moved a balance. */}
                          {r.status === "approved" ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                              onClick={() => setDiscardLeaveId(String(r.id))}
                            >
                              <Undo2 className="h-3 w-3" />
                              Discard
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-300">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DiscardDialog
        open={Boolean(discardLeaveId)}
        onOpenChange={(open) => { if (!open) setDiscardLeaveId(null); }}
        entityType="leave"
        entityId={discardLeaveId}
        onDiscarded={() => { setDiscardLeaveId(null); void refetchRequests(); }}
      />
    </div>
  );
}

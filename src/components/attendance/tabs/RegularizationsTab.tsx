import { Skeleton } from "@/components/ui/skeleton";
import { useRegularizationHistory } from "@/hooks/useAttendanceHub";

const STATUS_COLORS: Record<string, string> = {
  pending:          "bg-amber-50 text-amber-700",
  manager_approved: "bg-blue-50 text-blue-700",
  approved:         "bg-emerald-50 text-emerald-700",
  rejected:         "bg-rose-50 text-rose-700",
};

interface Props { employeeId: string; }

export function RegularizationsTab({ employeeId }: Props) {
  const { data: records = [], isLoading } = useRegularizationHistory(employeeId);

  if (isLoading) return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
    </div>
  );

  if (!records.length) return (
    <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-500">
      No regularization requests found.
    </div>
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <th className="px-4 py-3 text-left">Date</th>
            <th className="px-4 py-3 text-left">Type</th>
            <th className="px-4 py-3 text-left">From Status</th>
            <th className="px-4 py-3 text-left">Requested</th>
            <th className="px-4 py-3 text-left">Submitted</th>
            <th className="px-4 py-3 text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {records.map(r => {
            const statusCls = STATUS_COLORS[r.status] ?? "bg-slate-100 text-slate-600";
            return (
              <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{r.session_date?.slice(0, 10)}</td>
                <td className="px-4 py-2.5 text-xs text-slate-600 capitalize">
                  {(r as any).dispute_type
                    ? (["week_off_worked","holiday_worked","work_from_home"].includes((r as any).dispute_type)
                        ? "Exception"
                        : "Regularization")
                    : (r.request_category ?? "Regularization").replace(/_/g, " ")}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500 capitalize">{(r.old_status ?? "—").replace(/_/g, " ")}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500 capitalize">{(r.requested_status ?? "—").replace(/_/g, " ")}</td>
                <td className="px-4 py-2.5 text-xs text-slate-400">{r.submitted_at?.slice(0, 10)}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusCls}`}>
                    {(r.status ?? "—").replace(/_/g, " ")}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

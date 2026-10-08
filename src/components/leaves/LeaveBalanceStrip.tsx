import { Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLeaveBalances } from "@/hooks/useLeaveBalances";
import { leaveTypeChartVar } from "./leaveTheme";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** One card per leave type: what is left, what is used, out of what was allotted this year. */
export function LeaveBalanceStrip({ employeeId }: { employeeId?: string }) {
  const { data: balances, isLoading, isError } = useLeaveBalances(employeeId);

  if (!employeeId) return null;
  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
      </div>
    );
  }
  if (isError) {
    return <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">Could not load your leave balances. Refresh to try again.</p>;
  }
  const rows = (balances ?? []).filter((b) => Number(b.allocated_days ?? 0) + Number(b.adjusted_days ?? 0) > 0 || Number(b.used_days ?? 0) > 0);
  if (rows.length === 0) {
    return <p className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">No leave balance has been opened for you this year yet. Contact HR if this looks wrong.</p>;
  }
  const hasPool = rows.some((b) => b.leave_code === "CL") && rows.some((b) => b.leave_code === "ML");

  return (
    <section aria-label="Leave balances" className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((b) => {
          const total = b.allocated_days + b.adjusted_days;
          const pct = total > 0 ? Math.min(100, Math.round((b.used_days / total) * 100)) : 0;
          // leave_type is always set by useLeaveBalances; the fallbacks keep a malformed cache entry
          // from taking the whole page down.
          const name = b.leave_type?.name ?? b.leave_code ?? "Leave";
          const color = leaveTypeChartVar(b.leave_code || name);
          return (
            <div key={b.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{name}</p>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
              </div>
              <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">
                {fmt(b.available_days)}
                <span className="ml-1 text-sm font-medium text-muted-foreground">left</span>
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${name} used`}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{fmt(b.used_days)} used of {fmt(total)}</p>
            </div>
          );
        })}
      </div>
      {hasPool && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          Casual and Medical leave draw from a shared pool when one runs out.
        </p>
      )}
    </section>
  );
}

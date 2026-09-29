import { cn } from "@/lib/utils";
import type { CohortRow } from "./useOpsCommand";

function cell(v: number | null) {
  if (v === null) return <span className="text-muted-foreground">—</span>;
  const tone = v >= 80 ? "text-emerald-600 dark:text-emerald-400" : v >= 60 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  return <span className={cn("font-medium tabular-nums", tone)}>{v}%</span>;
}

/** Joining-month cohorts: of everyone who joined that month, what share was still here at 30 / 60 / 90 days. */
export function OpsCohorts({ cohorts, loading }: { cohorts: CohortRow[] | undefined; loading: boolean }) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b p-3">
        <h2 className="text-sm font-semibold">Joiner retention by joining month</h2>
        <p className="text-xs text-muted-foreground">Share of each month's joiners still employed at 30 / 60 / 90 days. A cell shows "—" until every joiner of that month could have reached that tenure.</p>
      </div>
      {loading && !cohorts ? <div className="m-3 h-24 animate-pulse rounded bg-muted" /> : !cohorts?.length ? (
        <p className="p-6 text-center text-sm text-muted-foreground">No joiners in your scope for the last 12 months.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Joined in</th><th className="px-3 py-2 text-right">Joiners</th><th className="px-3 py-2 text-right">Still active</th>
                <th className="px-3 py-2 text-right">Kept at 30d</th><th className="px-3 py-2 text-right">Kept at 60d</th><th className="px-3 py-2 text-right">Kept at 90d</th>
              </tr>
            </thead>
            <tbody>
              {[...cohorts].reverse().map((c) => (
                <tr key={c.month} className="border-b">
                  <td className="px-3 py-2 font-medium">{c.month.slice(5)}/{c.month.slice(0, 4)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.joined}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.stillActive} <span className="text-xs text-muted-foreground">({Math.round((c.stillActive / c.joined) * 100)}%)</span></td>
                  <td className="px-3 py-2 text-right">{cell(c.retention30)}</td>
                  <td className="px-3 py-2 text-right">{cell(c.retention60)}</td>
                  <td className="px-3 py-2 text-right">{cell(c.retention90)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

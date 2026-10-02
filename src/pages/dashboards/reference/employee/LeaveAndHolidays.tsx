import { Link } from "react-router-dom";
import { CalendarClock, CalendarDays, Hourglass } from "lucide-react";
import { KpiTiles, Panel, TablePanel } from "../../kit";
import type { InsightIndex } from "./insightIndex";

/** Leave balances with accrual, what lapses at year end, and the next holidays. */
export function LeaveAndHolidays({ ix, loading }: { ix: InsightIndex; loading: boolean }) {
  const balances = ix.table("leave_balances");
  const rows = balances?.rows ?? [];
  const tiles = ix.kpis(["leave_available", "leave_lapsing"]);
  const holidays = ix.table("holidays");
  const accrual = ix.table("leave_accrual");
  return (
    <div className="space-y-4">
      <KpiTiles kpis={tiles} loading={loading} cols={3} icons={{ leave_available: CalendarDays, leave_lapsing: Hourglass }} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Leave balances" subtitle="Granted, used and left per type" href="/leaves" hrefLabel="Apply leave" bodyClassName="p-0">
          {balances?.unavailable ? <p className="p-4 text-[12px] text-amber-700">{balances.unavailable}</p>
            : loading && !balances ? <div className="kit-shimmer m-4 h-32 rounded-xl" />
            : !rows.length ? <p className="p-4 text-[12px] text-slate-400">No leave types are allocated to you.</p> : (
              <ul className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const total = Number(r.total) || 0;
                  const used = Number(r.used) || 0;
                  const left = Number(r.remaining) || 0;
                  const pct = total > 0 ? Math.min(100, (left / total) * 100) : 0;
                  return (
                    <li key={String(r.type)} className="px-4 py-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-slate-800">{String(r.type)}</span>
                        <span className="kit-num text-[13px] font-extrabold text-emerald-700">{left} left</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${left} of ${total} days left`}>
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">{used} used of {total} · {String(r.note)}</p>
                    </li>
                  );
                })}
              </ul>
            )}
        </Panel>
        <div className="space-y-4">
          {holidays ? <TablePanel table={holidays} /> : loading ? <div className="kit-shimmer h-40 rounded-2xl" /> : null}
          {accrual ? <TablePanel table={accrual} /> : null}
          <Link to="/leaves" className="kit-card kit-lift flex items-center gap-3 p-4 text-[13px] font-semibold text-blue-700"><CalendarClock className="h-5 w-5" />Plan time off — apply for leave</Link>
        </div>
      </div>
    </div>
  );
}

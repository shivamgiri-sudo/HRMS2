import { Link } from "react-router-dom";
import { AlarmClockOff, ArrowRight, CheckCircle2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { InsightAction } from "../../../../backend/src/modules/dashboards/role-insights/types";
import { Panel } from "./Panel";

const SEV = {
  critical: { dot: "bg-rose-500 kit-alert-dot", chip: "bg-rose-50 text-rose-700 ring-rose-200", label: "Critical", rank: 0 },
  high: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800 ring-amber-200", label: "High", rank: 1 },
  normal: { dot: "bg-blue-500", chip: "bg-blue-50 text-blue-700 ring-blue-200", label: "Open", rank: 2 },
  info: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Clear", rank: 3 },
} as const;

/**
 * Pending-approvals / action queue. Every row deep-links to the page where the item is actioned,
 * is ordered by urgency, and surfaces SLA pressure (oldest age, overdue count).
 */
export function ActionCenter({ actions, loading, title = "Needs your action", subtitle, limit = 8, error }: {
  actions: InsightAction[] | undefined; loading?: boolean; title?: string; subtitle?: string; limit?: number; error?: string | null;
}) {
  const list = [...(actions ?? [])].sort((a, b) => SEV[a.severity].rank - SEV[b.severity].rank || (b.count ?? -1) - (a.count ?? -1));
  const open = list.filter((a) => (a.count ?? 0) > 0);
  const totalOpen = open.reduce((s, a) => s + (a.count ?? 0), 0);
  const shown = (open.length ? open : list).slice(0, limit);
  return (
    <Panel
      title={title}
      subtitle={subtitle ?? (loading ? "Loading…" : open.length ? `${totalOpen.toLocaleString("en-IN")} items across ${open.length} queues` : undefined)}
      action={open.some((a) => a.severity === "critical") ? <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 ring-1 ring-rose-200"><ShieldAlert className="h-3 w-3" />Action due</span> : null}
      bodyClassName="p-0"
    >
      {loading ? (
        <div className="space-y-2 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : error && !list.length ? (
        <p className="p-4 text-[12px] text-amber-700">Could not load queues: {error}</p>
      ) : !list.length ? (
        <p className="p-4 text-[12px] text-slate-400">No queues configured for this scope.</p>
      ) : !open.length ? (
        <div className="flex items-center gap-3 p-5 text-emerald-700"><CheckCircle2 className="h-6 w-6" /><p className="text-[13px] font-semibold">All clear — nothing is waiting on you.</p></div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.map((a) => {
            const s = SEV[a.severity];
            return (
              <li key={a.id}>
                <Link to={a.href} className="group flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", s.dot)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-slate-800">{a.label}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-slate-500">
                      {a.unavailable ? <span className="text-amber-700">{a.unavailable}</span> : (<>
                        {a.oldestDays !== null && a.oldestDays !== undefined ? <span>oldest {a.oldestDays}d</span> : null}
                        {a.overdue ? <span className="inline-flex items-center gap-1 font-semibold text-rose-600"><AlarmClockOff className="h-3 w-3" />{a.overdue} overdue</span> : null}
                        {a.hint ? <span className="truncate">{a.hint}</span> : null}
                      </>)}
                    </p>
                  </div>
                  <span className={cn("kit-num rounded-lg px-2.5 py-1 text-[15px] font-extrabold ring-1", s.chip)}>{a.count === null ? "—" : a.count.toLocaleString("en-IN")}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-600" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ActionCenter, Panel } from "../../kit";
import type { RoleInsights } from "../../kit";
import { groupTotals } from "./hrModel";

/** Work queues, oldest and most overdue first, with a per-area strip so HR can see where the pressure sits. */
export function HrActionBoard({ insights, loading, error }: { insights?: RoleInsights; loading: boolean; error?: string | null }) {
  const groups = groupTotals(insights?.actions);
  return (
    <div className="space-y-3">
      <ActionCenter actions={insights?.actions} loading={loading} error={error} limit={16} title="Needs HR action" subtitle={undefined} />
      {groups.length ? (
        <Panel title="Where the pressure sits" subtitle="Open items by area; red = past SLA">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {groups.map((g) => (
              <li key={g.group} className={cn("rounded-xl px-3 py-2 ring-1", g.overdue > 0 ? "bg-rose-50 ring-rose-100" : "bg-slate-50 ring-slate-100")}>
                <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g.group}</p>
                <p className="kit-num text-[18px] font-extrabold text-slate-900">{g.open.toLocaleString("en-IN")}</p>
                <p className={cn("text-[11px]", g.overdue > 0 ? "font-semibold text-rose-700" : "text-slate-400")}>{g.overdue > 0 ? `${g.overdue.toLocaleString("en-IN")} past SLA` : "within SLA"}</p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {insights?.sectionErrors && Object.keys(insights.sectionErrors).length ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-800 ring-1 ring-amber-100">
          Some sections could not load ({Object.keys(insights.sectionErrors).join(", ")}). The rest is live;{" "}
          <Link to="/hr/dashboard" reloadDocument className="font-semibold underline">reload</Link> to retry.
        </p>
      ) : null}
    </div>
  );
}

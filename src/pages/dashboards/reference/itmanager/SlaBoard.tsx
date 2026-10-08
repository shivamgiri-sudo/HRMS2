import { Link } from "react-router-dom";
import type { InsightAction, InsightKpi } from "../../kit";
import { formatUnit } from "../../kit";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const LIGHT = { critical: "bg-rose-500 kit-alert-dot", high: "bg-amber-400", normal: "bg-sky-400", info: "bg-emerald-400" } as const;
const LABEL = { critical: "BREACH", high: "AT RISK", normal: "OPEN", info: "CLEAR" } as const;

/**
 * Ops-board lanes: one card per queue with a status light, the number, oldest age and breach count.
 * Distinct from the card grid used elsewhere on purpose: IT reads this at a glance like a NOC wall.
 */
export function SlaBoard({ actions, loading }: { actions?: InsightAction[]; loading?: boolean }) {
  if (loading && !actions?.length) return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="SLA board">
      {(actions ?? []).map((a) => (
        <Link key={a.id} to={a.href} className="kit-card kit-lift group p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{a.group ?? "Queue"}</span>
            <span className="flex items-center gap-1.5 text-[10px] font-extrabold tracking-wider text-slate-600"><i className={cn("h-2.5 w-2.5 rounded-full", LIGHT[a.severity])} />{LABEL[a.severity]}</span>
          </div>
          <p className="mt-2 text-[13px] font-semibold text-slate-800">{a.label}</p>
          <p className="kit-num mt-2 text-[40px] font-black leading-none text-slate-900">{a.count === null ? "—" : a.count.toLocaleString("en-IN")}</p>
          <p className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
            {a.oldestDays !== null && a.oldestDays !== undefined ? <span>oldest {a.oldestDays}d</span> : null}
            {a.overdue ? <span className="font-bold text-rose-600">{a.overdue} overdue</span> : null}
            {a.hint ? <span className="truncate">{a.hint}</span> : null}
          </p>
        </Link>
      ))}
    </div>
  );
}

/** Compact read-out strip (assets, tickets, biometrics) with null shown as an em dash plus the reason. */
export function MetricStrip({ kpis, onDrill }: { kpis: InsightKpi[]; onDrill?: (k: InsightKpi) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {kpis.map((k) => {
        const f = formatUnit(k.value, k.unit);
        const body = (<>
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">{k.label}</p>
          <p className="kit-num mt-1 text-[24px] font-extrabold text-slate-900">{f.text}<span className="text-[0.55em] text-slate-400">{f.suffix}</span></p>
          <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500" title={k.formula}>{k.unavailable ?? k.helper ?? ""}</p>
        </>);
        const cls = "rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-cyan-400 hover:shadow-sm";
        return k.href ? <Link key={k.key} to={k.href} className={cls}>{body}</Link>
          : <button key={k.key} type="button" onClick={() => onDrill?.(k)} className={cls}>{body}</button>;
      })}
    </div>
  );
}

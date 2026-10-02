import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ChartEmpty, Panel, type RoleInsights } from "../../kit";
import { coverageSegments, kpiOf } from "./qualityModel";

/** Audit coverage as one stacked bar: audited / assessed but not scored / never assessed, out of calls analysed. */
export function CoverageMeter({ insights, loading }: { insights?: RoleInsights; loading?: boolean }) {
  const seg = coverageSegments(kpiOf(insights, "q_audited")?.value, kpiOf(insights, "q_pending")?.value, kpiOf(insights, "q_unscored")?.value);
  const reason = kpiOf(insights, "q_coverage")?.unavailable ?? kpiOf(insights, "q_pending")?.unavailable;
  const parts = seg ? [
    { key: "a", label: "Audited (scored)", v: seg.audited, cls: "bg-violet-600" },
    { key: "u", label: "Assessed, not scored", v: seg.assessedUnscored, cls: "bg-amber-400" },
    { key: "n", label: "Not assessed", v: seg.notAssessed, cls: "bg-slate-300" },
  ] : [];
  return (
    <Panel title="Audit coverage" subtitle="last 30 days - calls analysed vs calls that carry a quality score" href="/quality-dashboard" hrefLabel="Open audit page">
      {loading && !insights ? <div className="kit-shimmer h-28 rounded-xl" /> : !seg ? <ChartEmpty text={reason ?? "No analysed calls for this scope"} /> : (
        <div>
          <p className="kit-num text-[44px] font-black leading-none text-slate-900">{seg.coveragePct}<span className="text-[22px] text-slate-400">%</span></p>
          <p className="mt-1 text-[12px] text-slate-500">{seg.audited.toLocaleString("en-IN")} of {seg.total.toLocaleString("en-IN")} analysed calls scored · no coverage target is configured</p>
          <div className="mt-3 flex h-4 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={parts.map((p) => `${p.label} ${p.v}`).join(", ")}>
            {parts.filter((p) => p.v > 0).map((p) => <div key={p.key} className={cn("h-full", p.cls)} style={{ width: `${(p.v / seg.total) * 100}%` }} title={`${p.label}: ${p.v}`} />)}
          </div>
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-3">
            {parts.map((p) => (
              <li key={p.key}><Link to="/quality-dashboard" className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[12px] hover:bg-slate-50"><i className={cn("h-2.5 w-2.5 rounded-sm", p.cls)} /><span className="text-slate-600">{p.label}</span><span className="kit-num ml-auto font-bold text-slate-900">{p.v.toLocaleString("en-IN")}</span></Link></li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { arrayAt, asNumber, formatValue, read } from "../../reference-dashboard-model";
import { Panel, TrendChart } from "../../kit";
import type { CeoModel } from "./ceoModel";
import { qualityTone } from "./ceoModel";

const BAR = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500", slate: "bg-slate-300" } as const;
const CHIP = { green: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-800", red: "bg-rose-50 text-rose-700", slate: "bg-slate-100 text-slate-600" } as const;
const WORD = { green: "On track", amber: "At risk", red: "Critical", slate: "No data" } as const;

/**
 * Quality by process against the org target, worst first. The old table printed the backend status in a
 * hard-coded green regardless of its value ("Critical" in green); status is now coloured from the score.
 * Processes group on ClientId (Campaign stopped being written in April 2026, which once collapsed nine
 * processes into one row named "Process 1"), and nothing is sliced off — the two weakest are the ones to see.
 */
export function CeoQualityByProcess({ model }: { model: CeoModel }) {
  const rows = [...model.qualityRows].sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
  const target = model.qualityTarget;
  return (
    <Panel title="Quality vs target — by process" subtitle={rows.length ? `${rows.length} processes · last 30 days · worst first` : "Last 30 days"} href="/quality/executive" hrefLabel="Quality dashboard">
      {model.qualityNote ? <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">{model.qualityNote}</p> : null}
      {!rows.length ? <p className="py-8 text-center text-[12px] text-slate-400">Quality scorecard is unavailable</p> : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => {
            const tone = qualityTone(r.score, target);
            return (
              <li key={r.name}>
                <Link to="/quality/executive" className="flex items-center gap-3 py-2.5 transition hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] font-semibold text-slate-800">{r.name}</p>
                      <span className="kit-num text-[13px] font-extrabold text-slate-900">{formatValue(r.score)}</span>
                    </div>
                    <div className="relative mt-1.5 h-1.5 rounded-full bg-slate-100">
                      <span className={cn("absolute inset-y-0 left-0 rounded-full", BAR[tone])} style={{ width: `${Math.max(2, Math.min(100, r.score ?? 0))}%` }} />
                      {target !== null ? <span aria-hidden className="absolute -top-0.5 h-2.5 w-0.5 bg-slate-500" style={{ left: `${Math.min(100, target)}%` }} /> : null}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">{formatValue(r.agents)} agents · {formatValue(r.calls)} calls{target !== null && r.score !== null ? ` · ${(r.score - target >= 0 ? "+" : "")}${(r.score - target).toFixed(1)} vs target` : ""}</p>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold", CHIP[tone])}>{WORD[tone]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/**
 * KPI performance. There is no composite org KPI score in this database (kpi_daily_actual.actual_value mixes
 * percent, seconds, count and currency), so /api/kpi/org-summary picks ONE named headline metric — this panel
 * names it, which is the difference between "9.1/100" and "sales conversion averages 9.1%".
 */
export function CeoKpiPerformance({ data }: { data: ReferenceDashboardData }) {
  const k = data.orgKpi;
  const name = typeof k.metric_name === "string" ? k.metric_name : null;
  const unit = typeof k.metric_unit === "string" ? k.metric_unit : null;
  const unavailable = typeof k.unavailable === "string" ? k.unavailable : null;
  const scored = asNumber(k.employees_scored);
  const best = read(k, "best_process") as Record<string, unknown> | undefined;
  const worst = read(k, "needs_attention") as Record<string, unknown> | undefined;
  const score = asNumber(k.org_average_score ?? k.average_score ?? k.score);
  const trend = arrayAt(k, "trend").slice(-10).map((r) => ({ label: String(r.label ?? r.period ?? ""), value: Number(r.value ?? r.avg_score ?? r.score ?? 0) }));
  const suffix = unit === "percent" ? "%" : "";
  return (
    <Panel title="KPI performance" subtitle={`${name ?? "Headline KPI"}${scored === null ? "" : ` · ${scored} employees scored`}`} href="/operations-kpi" hrefLabel="KPI dashboard">
      {unavailable ? <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">{unavailable}</p> : null}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-400">{name ?? "Headline KPI"}</p><p className="kit-num mt-2 text-[22px] font-extrabold text-slate-900">{formatValue(score)}<span className="text-[12px] font-medium text-slate-400">{suffix}</span></p></div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3"><p className="text-[11px] text-slate-400">Best process</p><p className="mt-2 truncate text-[13px] font-bold text-emerald-700">{String(best?.name ?? best?.process_name ?? "—")}</p><p className="kit-num mt-1 text-[18px] font-extrabold text-slate-900">{formatValue(best?.score)}{suffix}</p></div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3"><p className="text-[11px] text-slate-400">Needs attention</p><p className="mt-2 truncate text-[13px] font-bold text-amber-700">{String(worst?.name ?? worst?.process_name ?? "—")}</p><p className="kit-num mt-1 text-[18px] font-extrabold text-slate-900">{formatValue(worst?.score)}{suffix}</p></div>
      </div>
      <div className="mt-3">{trend.length > 1 ? <TrendChart points={trend} unit={unit === "percent" ? "percent" : "score"} height={130} /> : <p className="py-6 text-center text-[12px] text-slate-400">No KPI trend for this period</p>}</div>
    </Panel>
  );
}

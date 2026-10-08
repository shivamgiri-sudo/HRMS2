import { Target } from "lucide-react";
import { DASH, formatValue } from "../format";
import { PacingBar } from "./PacingBar";
import { StatusChip } from "./status";
import type { ForecastKpi } from "./types";

const METHOD: Record<string, string> = {
  "weekday-seasonal-run-rate": "Same-weekday average of the last 8 weeks",
  "pooled-run-rate": "Average daily run-rate (a weekday had too few samples)",
  "linear-trend": "Trend of the last 14 days",
  "flat-mean": "Recent daily average",
  actual: "Month is over: actual",
  "insufficient-history": "Not enough history",
  none: "Not available",
};
export const methodLabel = (m: string) => METHOD[m] ?? m;

export function PacingCard({ k, selected, onSelect }: { k: ForecastKpi; selected: boolean; onSelect: () => void }) {
  const noProj = k.projected === null;
  const req = k.requiredDailyRate;
  return (
    <li className={`flex flex-col gap-2 rounded-xl border bg-white p-3 shadow-sm ${selected ? "border-blue-600 ring-1 ring-blue-600" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">{k.label}</h4>
        <StatusChip status={k.status} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium text-slate-700">{k.daysRemaining === 0 ? "Final" : "Projected month-end"}</p>
          <p className="text-xl font-bold leading-none tabular-nums text-slate-900">{noProj ? DASH : formatValue(k.projected, k.unit)}</p>
          {k.band && k.band.high !== k.band.low && <p className="mt-0.5 text-[11px] tabular-nums text-slate-700">{Math.round(k.band.level * 100)}% range {formatValue(k.band.low, k.unit)} to {formatValue(k.band.high, k.unit)}</p>}
        </div>
        <div className="text-right">
          <p className="text-[11px] font-medium text-slate-700">Month to date</p>
          <p className="text-sm font-bold tabular-nums text-slate-900">{formatValue(k.mtd, k.unit)}</p>
        </div>
      </div>
      <PacingBar k={k} />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-800">
        <dt className="text-slate-600">Target</dt>
        <dd className="text-right font-semibold tabular-nums">{k.target === null ? "None configured" : <span className="inline-flex items-center gap-1"><Target className="h-3 w-3" aria-hidden="true" />{formatValue(k.target, k.unit)}</span>}</dd>
        {k.pacingPct !== null && <><dt className="text-slate-600">Projected vs target</dt><dd className="text-right font-semibold tabular-nums">{k.pacingPct.toFixed(1)}%</dd></>}
        {req !== null && <><dt className="text-slate-600">{k.kind === "rate" ? "Needed avg, remaining days" : "Needed per working day"}</dt><dd className="text-right font-semibold tabular-nums">{formatValue(req, k.unit)}</dd></>}
        {k.expectedDaily !== null && k.daysRemaining > 0 && <><dt className="text-slate-600">{k.kind === "rate" ? "Expected daily level" : "Expected per working day"}</dt><dd className="text-right tabular-nums">{formatValue(k.expectedDaily, k.unit)}</dd></>}
        <dt className="text-slate-600">Working days</dt>
        <dd className="text-right tabular-nums">{k.daysElapsed} done, {k.daysRemaining} left</dd>
      </dl>
      {k.reason && <p className="rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-800">{k.reason}.</p>}
      <p className="text-[10px] text-slate-600">{methodLabel(k.method)}{k.partial?.value != null ? ` · today so far ${formatValue(k.partial.value, k.unit)} (not counted)` : ""}</p>
      <button type="button" aria-pressed={selected} onClick={onSelect}
        className="mt-auto min-h-[36px] cursor-pointer rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1">
        {selected ? `Showing ${k.label} below` : `Show ${k.label} chart and team table`}
      </button>
    </li>
  );
}

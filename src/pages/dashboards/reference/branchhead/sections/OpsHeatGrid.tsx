import { Clock3 } from "lucide-react";
import type { OpsProcessRow } from "../../../../../../backend/src/modules/branch-head-health/ops";
import type { TableSpec } from "../viz";
import { CoverageBadge, coverageLabel } from "../ProcessCoveragePanel";

/** Metric columns of the heat grid: payload key and header. */
export const OPS_METRICS: Array<[string, string]> = [
  ["AHT", "AHT"], ["INBOUND_SL_PCT", "SL %"], ["INBOUND_AL_PCT", "AL %"],
  ["QA_QUALITY_PCT", "QA %"], ["SHRINKAGE_PCT", "Shrinkage %"], ["FUNNEL_SALE_PCT", "Sale conversion %"],
];

/** Light half of the sequential blue ramp (100-300): dark ink stays readable on every step. */
const RAMP = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec"];

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const num = (v: number | null | undefined): string => (!fin(v) ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(1));

/** One-hue tint for `v` within its column's [min, max]; magnitude only, not good or bad. */
export function heatTint(v: number, min: number, max: number): string {
  if (!fin(v) || !fin(min) || !fin(max) || max <= min) return RAMP[0];
  const t = Math.min(1, Math.max(0, (v - min) / (max - min)));
  return RAMP[Math.round(t * (RAMP.length - 1))];
}

/** Table twin of the grid: the same rows and numbers, as text. */
export function opsTable(rows: OpsProcessRow[]): TableSpec {
  return {
    caption: "Latest operational metrics per process",
    columns: ["Process", "Coverage", ...OPS_METRICS.map(([, l]) => l), "Latest", "Freshness"],
    rows: rows.map((r) => [r.processName, coverageLabel(r.tier), ...OPS_METRICS.map(([k]) => num(r.metrics?.[k])), r.latestDate ?? "—", r.stale ? "Stale" : "Current"]),
  };
}

export function StaleBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[12px] font-semibold text-amber-900">
      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />Stale
    </span>
  );
}

const HATCH = "repeating-linear-gradient(135deg, transparent 0 6px, rgba(137, 135, 129, 0.18) 6px 8px)";

/**
 * Processes x metrics as a real table: each cell shows its number on a tint scaled within its column,
 * stale rows are hatched and say "Stale", missing values are an em dash. Wide grids scroll inside.
 */
export function OpsHeatGrid({ rows, onSelectProcess }: { rows: OpsProcessRow[]; onSelectProcess?: (name: string) => void }) {
  const ranges = OPS_METRICS.map(([k]) => {
    const vals = rows.map((r) => r.metrics?.[k]).filter(fin);
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 0];
  });
  return (
    <div className="overflow-x-auto">
      <table className="bhl-heat w-full min-w-[720px] border-separate border-spacing-[2px] text-left text-[13px]">
        <caption className="sr-only">Latest operational metrics per process; cell shade shows size within each column</caption>
        <thead>
          <tr className="text-slate-700">
            <th scope="col" className="py-1 pr-2">Process</th>
            <th scope="col" className="py-1 pr-2">Coverage</th>
            {OPS_METRICS.map(([, l]) => <th key={l} scope="col" className="px-2 py-1 text-right">{l}</th>)}
            <th scope="col" className="py-1 pr-2">Latest</th>
            <th scope="col" className="py-1">Freshness</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.processCode}>
              <th scope="row" className="py-1 pr-2 font-semibold text-slate-900" style={r.stale ? { backgroundImage: HATCH } : undefined}>
                {onSelectProcess ? (
                  <button type="button" onClick={() => onSelectProcess(r.processName)}
                    className="min-h-[44px] text-left font-semibold underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                    {r.processName}
                  </button>
                ) : r.processName}
              </th>
              <td className="py-1 pr-2"><CoverageBadge tier={r.tier} /></td>
              {OPS_METRICS.map(([k, l], j) => {
                const v = r.metrics?.[k];
                return (
                  <td key={l} className="rounded px-2 py-2 text-right tabular-nums"
                    style={fin(v) ? { background: heatTint(v, ranges[j][0], ranges[j][1]), color: "#0b0b0b" } : undefined}>
                    {num(v)}
                  </td>
                );
              })}
              <td className="py-1 pr-2">{r.latestDate ?? "—"}</td>
              <td className="py-1">{r.stale ? <StaleBadge /> : "Current"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

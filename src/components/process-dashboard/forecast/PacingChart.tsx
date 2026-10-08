import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatValue } from "../format";
import { SimpleTable } from "../SimpleTable";
import { Empty, FOCUS, reduceMotion } from "../ui";
import type { ForecastKpi } from "./types";

const shortDay = (d: string) => { const t = new Date(`${d}T00:00:00`); return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); };

/** Chart rows: actuals, then the projection (joined to the last actual for cumulative series). Non-working days are absent: the x axis is working days. */
export function chartRows(k: ForecastKpi) {
  return (k.path ?? []).map((p) => ({ date: p.date, actual: p.actual, projected: p.projected, band: p.low !== null && p.high !== null ? [p.low, p.high] : null }));
}

export function PacingChart({ k, onDay }: { k: ForecastKpi; onDay: (d: string) => void }) {
  const rows = useMemo(() => chartRows(k), [k]);
  const cumulative = k.pathKind === "cumulative";
  const what = cumulative ? `Cumulative ${k.label} by working day` : `Daily ${k.label} by working day`;
  if (!rows.length || k.projected === null) return <Empty>{k.reason ? `${k.label}: ${k.reason}.` : `No projection for ${k.label}.`}</Empty>;
  return (
    <div>
      <div role="img" aria-label={`${what}: actual to date, projected through month end with an ${Math.round((k.band?.level ?? 0.8) * 100)}% range${k.target !== null ? `, target ${formatValue(k.target, k.unit)}` : ", no target"}. Click an actual day to open its breakdown.`} className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} style={{ cursor: "pointer" }}
            onClick={(e) => { const label = (e as { activeLabel?: string } | undefined)?.activeLabel; const row = rows.find((r) => r.date === label); if (label && row && row.actual !== null) onDay(String(label)); }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatValue(v as number, k.unit)} width={60} domain={[0, "auto"]} />
            <Tooltip labelFormatter={(d) => shortDay(String(d))} formatter={(v, n) => [Array.isArray(v) ? `${formatValue(Number(v[0]), k.unit)} to ${formatValue(Number(v[1]), k.unit)}` : formatValue(typeof v === "number" ? v : null, k.unit), n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="band" name={`${Math.round((k.band?.level ?? 0.8) * 100)}% range`} stroke="none" fill="#2563eb" fillOpacity={0.15} isAnimationActive={false} connectNulls />
            <Line type="monotone" dataKey="actual" name="Actual" stroke="#0f172a" strokeWidth={2.5} dot={{ r: 2 }} isAnimationActive={!reduceMotion()} connectNulls={false} />
            <Line type="monotone" dataKey="projected" name="Projected" stroke="#2563eb" strokeWidth={2.5} strokeDasharray="6 4" dot={false} isAnimationActive={!reduceMotion()} connectNulls={false} />
            {k.target !== null && <ReferenceLine y={k.target} stroke="#b91c1c" strokeDasharray="2 3" strokeWidth={2} label={{ value: `Target ${formatValue(k.target, k.unit)}`, position: "insideTopLeft", fontSize: 11, fill: "#7f1d1d" }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-xs text-slate-800">
        <summary className={`cursor-pointer rounded font-semibold ${FOCUS}`}>View as table</summary>
        <div className="mt-2">
          <SimpleTable caption={`${what}, actual and projected`} maxHeight="max-h-72" onRow={(r) => { if (r.actual !== null) onDay(String(r.date)); }} rowLabel={(r) => `Open ${r.date}`}
            cols={[{ key: "date", label: "Date", align: "left" }, { key: "actual", label: "Actual", unit: k.unit }, { key: "projected", label: "Projected", unit: k.unit }, { key: "low", label: "Low", unit: k.unit }, { key: "high", label: "High", unit: k.unit }]}
            rows={(k.path ?? []) as unknown as Array<Record<string, unknown>>} />
        </div>
      </details>
    </div>
  );
}

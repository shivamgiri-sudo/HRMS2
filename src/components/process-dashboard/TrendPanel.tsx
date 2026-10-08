import { useEffect, useMemo, useState } from "react";
import { Area, Brush, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatValue } from "./format";
import { Empty, FOCUS, Panel, SERIES_COLORS, reduceMotion } from "./ui";
import { SimpleTable } from "./SimpleTable";
import type { Kpi, Overview } from "./types";
import { WhyButton } from "./rootcause/WhyButton";

const shortDay = (d: string) => { const t = new Date(`${d}T00:00:00`); return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); };

export function TrendPanel({ overview, focusKey, onFocusKey, onDay, selectedDay, onWhy }: { overview?: Overview; focusKey: string; onFocusKey: (k: string) => void; onDay: (d: string) => void; selectedDay?: string; onWhy?: (metric: string, from: string, to: string) => void }) {
  const trend = useMemo(() => overview?.trend ?? [], [overview?.trend]);
  const metrics = useMemo(() => (overview?.kpis ?? []).filter((k) => trend.some((r) => typeof r[k.key] === "number")), [overview?.kpis, trend]);
  const [picked, setPicked] = useState<string[]>([]);
  const [brush, setBrush] = useState<{ s: number; e: number } | null>(null);
  useEffect(() => { if (focusKey && metrics.some((m) => m.key === focusKey)) setPicked([focusKey]); }, [focusKey, metrics]);
  const selected: Kpi[] = useMemo(() => {
    const byKey = picked.map((k) => metrics.find((m) => m.key === k)).filter(Boolean) as Kpi[];
    return byKey.length ? byKey : metrics.slice(0, 2);
  }, [picked, metrics]);
  const units = Array.from(new Set(selected.map((m) => m.unit ?? "")));
  const axisOf = (m: Kpi) => (units.indexOf(m.unit ?? "") === 0 ? "l" : "r");
  const toggle = (k: string) => { const cur = selected.map((m) => m.key); const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k].slice(-4); setPicked(next.length ? next : cur); if (next.length === 1) onFocusKey(next[0]); };

  return (
    <Panel title="Trend">
      {trend.length === 0 || metrics.length === 0 ? <Empty>No daily trend for this range.</Empty> : (
        <>
          <div role="group" aria-label="Metrics shown on the trend chart" className="mb-3 flex flex-wrap gap-1.5">
            {metrics.map((m) => { const on = selected.some((s) => s.key === m.key); const i = selected.findIndex((s) => s.key === m.key);
              return <button key={m.key} type="button" aria-pressed={on} onClick={() => toggle(m.key)}
                className={`min-h-[32px] cursor-pointer rounded-full border px-2.5 text-xs font-semibold ${FOCUS} ${on ? "border-blue-700 bg-blue-50 text-blue-900" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
                {on && <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />}{m.label}</button>; })}
          </div>
          {onWhy && selected[0] && (() => {
            const first = trend[0]?.date, last = trend[trend.length - 1]?.date;
            const b = brush && brush.e > brush.s && (brush.s > 0 || brush.e < trend.length - 1) ? { from: trend[brush.s]?.date, to: trend[brush.e]?.date } : null;
            const range = b?.from && b.to ? b : first && last ? { from: first, to: last } : null;
            const m = selected[0];
            return (
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-700">
                {selectedDay && <><WhyButton label={`${m.label} on ${selectedDay}`} onClick={() => onWhy(m.key, selectedDay, selectedDay)} /><span>{m.label} on {selectedDay} vs the same weekday last week</span></>}
                {range && <><WhyButton label={`${m.label} over ${b ? "the selected range" : "this range"}`} onClick={() => onWhy(m.key, range.from, range.to)} /><span>{m.label}, {b ? "brushed range" : "whole range"} {range.from === range.to ? range.from : `${range.from} to ${range.to}`}</span></>}
              </div>
            );
          })()}
          <div role="img" aria-label={`Daily trend of ${selected.map((m) => m.label).join(", ")}. Click a day to open its breakdown.`} className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} style={{ cursor: "pointer" }}
                onClick={(e) => { const label = (e as { activeLabel?: string } | undefined)?.activeLabel; if (label) onDay(String(label)); }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="l" tick={{ fontSize: 11 }} tickFormatter={(v) => formatValue(v as number, selected[0]?.unit)} width={56} />
                {units.length > 1 && <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => formatValue(v as number, units[1])} width={56} />}
                <Tooltip labelFormatter={(d) => shortDay(String(d))} formatter={(v, n) => { const m = selected.find((s) => s.label === n); return [formatValue(typeof v === "number" ? v : null, m?.unit), n]; }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {selected.map((m, i) => (i === 0 && selected.length === 1
                  ? <Area key={m.key} yAxisId="l" type="monotone" dataKey={m.key} name={m.label} stroke={SERIES_COLORS[0]} fill={SERIES_COLORS[0]} fillOpacity={0.12} strokeWidth={2} isAnimationActive={!reduceMotion()} connectNulls />
                  : <Line key={m.key} yAxisId={axisOf(m)} type="monotone" dataKey={m.key} name={m.label} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2} strokeDasharray={i % 2 ? "5 3" : undefined} dot={false} isAnimationActive={!reduceMotion()} connectNulls />))}
                {trend.length > 14 && <Brush dataKey="date" height={22} stroke="#2563eb" tickFormatter={shortDay} onChange={(r) => { const x = r as { startIndex?: number; endIndex?: number }; if (typeof x.startIndex === "number" && typeof x.endIndex === "number") setBrush({ s: x.startIndex, e: x.endIndex }); }} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-3 text-xs text-slate-800">
            <summary className={`cursor-pointer rounded font-semibold ${FOCUS}`}>View as table</summary>
            <div className="mt-2">
              <SimpleTable caption="Daily trend values" onRow={(r) => onDay(String(r.date))}
                cols={[{ key: "date", label: "Date", align: "left" }, ...selected.map((m) => ({ key: m.key, label: m.label, unit: m.unit }))]} rows={trend} rowLabel={(r) => `Open ${r.date}`} />
            </div>
          </details>
        </>
      )}
    </Panel>
  );
}

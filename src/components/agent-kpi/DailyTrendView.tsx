import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader } from "lucide-react";
import {
  type DailyRow, type DrawerSpec, type TrendMetric,
  fmtDate, fmtDuration, fmtHoursMinutes, fmtNum, fmtPct, getData, withAgent,
} from "./agent-kpi-model";

type Col = { label: string; value: (r: DailyRow) => string; highlight?: boolean };
type MetricDef = {
  note?: string;
  bars: Array<{ key: string; name: string; color: string; value: (r: DailyRow) => number | null }>;
  line?: { name: string; color: string; value: (r: DailyRow) => number | null; unit: "%" };
  barUnit?: "duration" | "hours" | "count" | "%";
  summary: (rows: DailyRow[]) => Array<{ label: string; value: string }>;
  cols: Col[];
  /** What clicking a date opens. */
  drill: (r: DailyRow) => DrawerSpec;
};

const sum = (rows: DailyRow[], f: (r: DailyRow) => number) => rows.reduce((a, r) => a + f(r), 0);
const ratio = (num: number, den: number) => (den > 0 ? Math.round((1000 * num) / den) / 10 : null);
/** Weighted average of a per-day average, weighted by that day's calls. */
const wavg = (rows: DailyRow[], v: (r: DailyRow) => number | null, w: (r: DailyRow) => number) => {
  let s = 0, n = 0;
  for (const r of rows) { const x = v(r); if (x !== null) { s += x * w(r); n += w(r); } }
  return n > 0 ? s / n : null;
};
const workedDays = (rows: DailyRow[]) => rows.filter((r) => r.handled > 0);
const dayCalls = (r: DailyRow, extra: Partial<{ sl: "in" | "out"; sort: "duration" }> = {}, title = "Calls answered"): DrawerSpec =>
  ({ kind: "calls", title: `${title} · ${fmtDate(r.date)}`, filter: { from: r.date, to: r.date, ...extra } });

const C = { indigo: "#4f46e5", green: "#22c55e", red: "#ef4444", orange: "#f59e0b", blue: "#3b82f6", fuchsia: "#c026d3", teal: "#14b8a6", slate: "#94a3b8" };

const METRICS: Record<TrendMetric, MetricDef> = {
  offered: {
    note: "Queue totals for the campaigns you handled on each date (offered calls are not assigned to one agent).",
    bars: [
      { key: "offered", name: "Offered", color: C.blue, value: (r) => r.queue_offered },
      { key: "answered", name: "Answered (queue)", color: C.green, value: (r) => r.queue_answered },
    ],
    line: { name: "Abandon %", color: C.red, value: (r) => r.queue_abandon_pct, unit: "%" },
    summary: (rows) => [
      { label: "Offered", value: fmtNum(sum(rows, (r) => r.queue_offered)) },
      { label: "Answered", value: fmtNum(sum(rows, (r) => r.queue_answered)) },
      { label: "Abandoned", value: fmtNum(sum(rows, (r) => r.queue_abandoned)) },
      { label: "Abandon %", value: fmtPct(ratio(sum(rows, (r) => r.queue_abandoned), sum(rows, (r) => r.queue_offered))) },
    ],
    cols: [
      { label: "Offered", value: (r) => fmtNum(r.queue_offered), highlight: true },
      { label: "Answered", value: (r) => fmtNum(r.queue_answered) },
      { label: "Abandoned", value: (r) => fmtNum(r.queue_abandoned) },
      { label: "Abandon %", value: (r) => fmtPct(r.queue_abandon_pct) },
      { label: "You answered", value: (r) => fmtNum(r.handled) },
    ],
    drill: (r) => ({ kind: "queue", title: `Queue on your campaigns · ${fmtDate(r.date)}`, from: r.date, to: r.date }),
  },
  abandoned: {
    note: "Abandoned calls never reached an agent. These are queue totals for the campaigns you handled on each date.",
    bars: [{ key: "abandoned", name: "Abandoned", color: C.red, value: (r) => r.queue_abandoned }],
    line: { name: "Abandon %", color: C.orange, value: (r) => r.queue_abandon_pct, unit: "%" },
    summary: (rows) => [
      { label: "Abandoned", value: fmtNum(sum(rows, (r) => r.queue_abandoned)) },
      { label: "Offered", value: fmtNum(sum(rows, (r) => r.queue_offered)) },
      { label: "Abandon %", value: fmtPct(ratio(sum(rows, (r) => r.queue_abandoned), sum(rows, (r) => r.queue_offered))) },
    ],
    cols: [
      { label: "Abandoned", value: (r) => fmtNum(r.queue_abandoned), highlight: true },
      { label: "Abandon %", value: (r) => fmtPct(r.queue_abandon_pct) },
      { label: "Offered", value: (r) => fmtNum(r.queue_offered) },
    ],
    drill: (r) => ({ kind: "queue", title: `Queue on your campaigns · ${fmtDate(r.date)}`, from: r.date, to: r.date }),
  },
  answered: {
    bars: [
      { key: "handled", name: "Answered", color: C.indigo, value: (r) => r.handled },
      { key: "w20", name: "Answered ≤20s", color: C.green, value: (r) => r.within_20s },
    ],
    line: { name: "SL %", color: C.orange, value: (r) => r.sl_pct, unit: "%" },
    summary: (rows) => [
      { label: "Answered", value: fmtNum(sum(rows, (r) => r.handled)) },
      { label: "Days worked", value: fmtNum(workedDays(rows).length) },
      { label: "Avg / day", value: workedDays(rows).length ? fmtNum(Math.round(sum(rows, (r) => r.handled) / workedDays(rows).length)) : "—" },
      { label: "SL %", value: fmtPct(ratio(sum(rows, (r) => r.within_20s), sum(rows, (r) => r.handled))) },
    ],
    cols: [
      { label: "Answered", value: (r) => fmtNum(r.handled), highlight: true },
      { label: "≤20s", value: (r) => fmtNum(r.within_20s) },
      { label: "SL %", value: (r) => fmtPct(r.sl_pct) },
      { label: "AHT", value: (r) => fmtDuration(r.aht_s) },
      { label: "Talk time", value: (r) => fmtDuration(r.talk_s, true) },
    ],
    drill: (r) => dayCalls(r),
  },
  sl: {
    bars: [
      { key: "w20", name: "Answered ≤20s", color: C.green, value: (r) => r.within_20s },
      { key: "late", name: "Answered >20s", color: C.red, value: (r) => r.handled - r.within_20s },
    ],
    line: { name: "SL %", color: C.orange, value: (r) => r.sl_pct, unit: "%" },
    summary: (rows) => [
      { label: "Within 20 sec", value: fmtNum(sum(rows, (r) => r.within_20s)) },
      { label: "After 20 sec", value: fmtNum(sum(rows, (r) => r.handled - r.within_20s)) },
      { label: "SL %", value: fmtPct(ratio(sum(rows, (r) => r.within_20s), sum(rows, (r) => r.handled))) },
    ],
    cols: [
      { label: "≤20s", value: (r) => fmtNum(r.within_20s), highlight: true },
      { label: ">20s", value: (r) => fmtNum(r.handled - r.within_20s) },
      { label: "Answered", value: (r) => fmtNum(r.handled) },
      { label: "SL %", value: (r) => fmtPct(r.sl_pct) },
    ],
    drill: (r) => dayCalls(r, { sl: "in" }, "Calls answered within 20 sec"),
  },
  aht: {
    barUnit: "duration",
    bars: [{ key: "aht", name: "AHT", color: C.orange, value: (r) => r.aht_s }],
    summary: (rows) => {
      const w = workedDays(rows);
      return [
        { label: "AHT (period)", value: fmtDuration(wavg(w, (r) => r.aht_s, (r) => r.handled)) },
        { label: "Avg hold", value: fmtDuration(wavg(w, (r) => r.avg_hold_s, (r) => r.handled)) },
        { label: "Avg after-call work", value: fmtDuration(wavg(w, (r) => r.avg_acw_s, (r) => r.handled)) },
        { label: "Talk time", value: fmtDuration(sum(rows, (r) => r.talk_s), true) },
      ];
    },
    cols: [
      { label: "AHT", value: (r) => fmtDuration(r.aht_s), highlight: true },
      { label: "Avg hold", value: (r) => fmtDuration(r.avg_hold_s) },
      { label: "Avg ACW", value: (r) => fmtDuration(r.avg_acw_s) },
      { label: "Talk time", value: (r) => fmtDuration(r.talk_s, true) },
      { label: "Calls", value: (r) => fmtNum(r.handled) },
    ],
    drill: (r) => dayCalls(r, { sort: "duration" }, "Longest calls first"),
  },
  login: {
    note: "Net login from the dialer productivity report (wait + talk + wrap-up + pause).",
    barUnit: "hours",
    bars: [{ key: "login", name: "Net login (hours)", color: C.fuchsia, value: (r) => (r.login_s === null ? null : Math.round((r.login_s / 3600) * 100) / 100) }],
    summary: (rows) => {
      const days = rows.filter((r) => r.login_s !== null);
      const total = sum(days, (r) => r.login_s ?? 0);
      return [
        { label: "Days logged in", value: fmtNum(days.length) },
        { label: "Total net login", value: fmtHoursMinutes(total) },
        { label: "Average / day", value: days.length ? fmtHoursMinutes(total / days.length) : "—" },
      ];
    },
    cols: [
      { label: "Net login", value: (r) => fmtHoursMinutes(r.login_s), highlight: true },
      { label: "First login", value: (r) => r.first_login ?? "—" },
      { label: "Calls", value: (r) => fmtNum(r.handled) },
    ],
    drill: (r) => dayCalls(r),
  },
  quality: {
    note: "CQ % per audit date, excluding fatal calls (audit-site definition).",
    bars: [{ key: "audits", name: "Audits", color: C.teal, value: (r) => r.audits }],
    line: { name: "CQ %", color: C.indigo, value: (r) => r.cq_pct, unit: "%" },
    summary: (rows) => {
      const a = rows.filter((r) => r.audits > 0);
      return [
        { label: "Audits", value: fmtNum(sum(a, (r) => r.audits)) },
        { label: "Avg CQ %", value: fmtPct(wavg(a, (r) => r.cq_pct, (r) => r.audits - r.fatal_calls)) },
        { label: "Fatal calls", value: fmtNum(sum(a, (r) => r.fatal_calls)) },
      ];
    },
    cols: [
      { label: "CQ %", value: (r) => (r.audits ? fmtPct(r.cq_pct) : "—"), highlight: true },
      { label: "Audits", value: (r) => fmtNum(r.audits) },
      { label: "Fatal", value: (r) => fmtNum(r.fatal_calls) },
    ],
    drill: (r) => dayCalls(r, {}, "Calls (audited ones show CQ)"),
  },
};

function shiftMonth(iso: string, delta: number): { from: string; to: string } {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const from = d.toISOString().slice(0, 10);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { from, to: last };
}

export function DailyTrendView({ metric, from: initialFrom, to: initialTo, agentCode, onOpen }: {
  metric: TrendMetric; from: string; to: string; agentCode?: string; onOpen: (s: DrawerSpec) => void;
}) {
  const [range, setRange] = useState({ from: initialFrom, to: initialTo });
  const def = METRICS[metric];
  const q = useQuery({
    queryKey: ["agent-kpi", "daily", agentCode, range.from, range.to],
    queryFn: () => getData<{ days: DailyRow[] }>(withAgent(`/api/agent/my-daily?from=${range.from}&to=${range.to}`, agentCode)),
  });

  const current = shiftMonth(initialTo, 0);
  const previous = shiftMonth(initialTo, -1);
  const isPrev = range.from === previous.from;
  const rows = q.data?.days ?? [];
  const chartRows = [...rows].reverse().map((r) => {
    const o: Record<string, number | string | null> = { date: r.date, label: `${r.date.slice(8, 10)}/${r.date.slice(5, 7)}` };
    for (const b of def.bars) o[b.key] = b.value(r);
    if (def.line) o.line = def.line.value(r);
    return o;
  });
  const fmtBar = (v: number) => (def.barUnit === "duration" ? fmtDuration(v) : def.barUnit === "hours" ? `${v}h` : fmtNum(v));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
          <button onClick={() => setRange({ from: current.from, to: initialTo })} className={`rounded-md px-3 py-1 ${!isPrev ? "bg-indigo-600 text-white shadow" : "text-slate-600"}`}>This month</button>
          <button onClick={() => setRange(previous)} className={`rounded-md px-3 py-1 ${isPrev ? "bg-indigo-600 text-white shadow" : "text-slate-600"}`}>Last month</button>
        </div>
        <span className="text-xs text-slate-500">{fmtDate(range.from)} – {fmtDate(range.to)}</span>
      </div>
      {def.note && <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">{def.note}</p>}

      {q.isLoading && <div className="flex justify-center py-12"><Loader className="animate-spin text-indigo-500" size={24} /></div>}
      {q.isError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Could not load the date-wise data. Please try again.</p>}

      {q.isSuccess && (rows.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">No activity in this period.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {def.summary(rows).map((s) => (
              <div key={s.label} className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-[11px] text-slate-500">{s.label}</p>
                <p className="text-base font-bold text-slate-900">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="h-56 rounded-lg border border-slate-200 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartRows} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}
                onClick={(e: { activeTooltipIndex?: number } | null) => {
                  const r = e?.activeTooltipIndex !== undefined ? [...rows].reverse()[e.activeTooltipIndex] : undefined;
                  if (r) onOpen(def.drill(r));
                }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="l" tick={{ fontSize: 10 }} tickFormatter={(v) => (def.barUnit === "duration" ? fmtDuration(v) : String(v))} />
                {def.line && <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />}
                <Tooltip formatter={(v: number, name: string) => (def.line && name === def.line.name ? fmtPct(v) : fmtBar(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {def.bars.map((b) => <Bar key={b.key} yAxisId="l" dataKey={b.key} name={b.name} fill={b.color} radius={[3, 3, 0, 0]} cursor="pointer" />)}
                {def.line && <Line yAxisId="r" dataKey="line" name={def.line.name} stroke={def.line.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  {def.cols.map((c) => <th key={c.label} className="px-3 py-2">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.date} onClick={() => onOpen(def.drill(r))} className="cursor-pointer border-t hover:bg-indigo-50/50">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{fmtDate(r.date)}</td>
                    {def.cols.map((c) => (
                      <td key={c.label} className={`px-3 py-2 ${c.highlight ? "font-bold text-slate-900" : "text-slate-600"}`}>{c.value(r)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400">Click a date (or a bar) to see that day's records.</p>
        </>
      ))}
    </div>
  );
}

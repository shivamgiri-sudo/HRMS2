import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { X, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  type HPColumn, type HPOverviewValues, type HPAgentWiseData, type HPAgentPerfRow, HP_API, fmtDate, fmtN,
} from "./housingPremiumShared";
import { METRICS, METRIC_BY_KEY, fmtMetric, type MetricDef, type MetricKey } from "./housingPremiumMetrics";
import { formatINR, DrawerExcelButton, PeriodModeToggle, type PeriodViewMode, type DrawerSheet } from "./DashboardKit";

export type HpDrillTarget =
  | { kind: "metric"; key: MetricKey }
  | { kind: "period"; colKey: string }
  | { kind: "tl"; tlName: string }
  /** Several metrics side by side (a whole card/chart), week-wise and date-wise. */
  | { kind: "group"; title: string; keys: MetricKey[] }
  /** Every metric, week-wise and date-wise, with an in-drawer TL filter (Overall / TL Wise Performance "View details"). */
  | { kind: "matrix"; title: string; tlName?: string };

interface TlBlock { tlName: string; agentCount: number; values: Record<string, HPOverviewValues> }

const TOOLTIP_PROPS = {
  contentStyle: { fontSize: 12, borderRadius: 10, border: "1px solid #334155", background: "#0f172a", boxShadow: "0 8px 24px rgba(15,23,42,0.4)", padding: "8px 12px" },
  labelStyle: { color: "#f1f5f9", fontWeight: 600, marginBottom: 4 },
} as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</p>
      {children}
    </section>
  );
}
const None = () => <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p>;
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-center">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-base font-bold tracking-tight text-slate-800">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

interface Row { key: string; cells: ReactNode[]; onClick?: () => void }

const SERIES_COLORS = ["#4f46e5", "#10b981", "#ef4444", "#f59e0b", "#0ea5e9"];

/** Large trend chart for a card's "View details": every metric of the card across the days (or weeks) of the range.
 * A metric far smaller than the biggest one (e.g. Sale Count next to Revenue) goes on a right-hand axis so it stays readable. */
function LargeTrendChart({ defs, values, cols }: { defs: MetricDef[]; values: Record<string, HPOverviewValues>; cols: HPColumn[] }) {
  if (cols.length === 0) return <None />;
  const data = cols.map((c) => ({ label: c.label, ...Object.fromEntries(defs.map((d) => [d.key, values[c.key]?.[d.key] ?? 0])) }));
  const maxOf = (k: string) => Math.max(0, ...data.map((r) => Number((r as Record<string, unknown>)[k]) || 0));
  const top = Math.max(1, ...defs.map((d) => maxOf(d.key)));
  const onRight = (d: MetricDef) => maxOf(d.key) * 15 < top;
  const hasRight = defs.some(onRight);
  const tick = (v: number) => (v >= 100000 ? `${Math.round(v / 1000) / 100}L` : v >= 1000 ? `${Math.round(v / 100) / 10}K` : String(v));
  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={tick} />
        {hasRight && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={tick} />}
        <Tooltip {...TOOLTIP_PROPS} formatter={(v: number, _n: string, item: { dataKey?: string | number }) => { const d = defs.find((x) => x.key === item?.dataKey); return d ? fmtMetric(Number(v), d.fmt) : String(v); }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {defs.map((d, i) => {
          const color = SERIES_COLORS[i % SERIES_COLORS.length];
          const axis = onRight(d) ? "right" : "left";
          return i === 0 && d.fmt !== "pct" && defs.length > 1
            ? <Bar key={d.key} yAxisId={axis} dataKey={d.key} name={d.label} fill={color} fillOpacity={0.55} radius={[3, 3, 0, 0]} />
            : <Line key={d.key} yAxisId={axis} type="monotone" dataKey={d.key} name={d.label} stroke={color} strokeWidth={2.5} dot={{ r: 3 }} />;
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Overall values + Week-wise / Date-wise / Combined tables + Excel, for a "group" drill (several metrics of one card). */
function GroupBody({
  defs, mtdLabel, overall, weekCols, dayCols, shownRow, sheets, fileBase, onPeriod, chartDefs, values, showChart = true,
}: {
  defs: Array<{ key: string; label: string }>; mtdLabel: string; overall: string[];
  /** Full metric definitions + the overview values, for the large trend chart. */
  chartDefs: MetricDef[]; values: Record<string, HPOverviewValues>; showChart?: boolean;
  weekCols: HPColumn[]; dayCols: HPColumn[]; shownRow: (c: HPColumn) => string[];
  sheets: () => DrawerSheet[]; fileBase: string; onPeriod: (colKey: string) => void;
}) {
  const [mode, setMode] = useState<PeriodViewMode>("combined");
  const [gran, setGran] = useState<"day" | "week">(dayCols.length > 0 ? "day" : "week");
  const head = defs.map((d) => d.label);
  const dayRow = (c: HPColumn, indent = false): Row => ({ key: c.key, onClick: () => onPeriod(c.key), cells: [indent ? <span className="pl-3">{c.label}</span> : c.label, ...shownRow(c)] });
  const weekRow = (c: HPColumn): Row => ({ key: c.key, onClick: () => onPeriod(c.key), cells: [<b key="w">{c.label}</b>, ...shownRow(c).map((x, i) => <b key={i}>{x}</b>)] });
  const inWeek = (w: HPColumn) => dayCols.filter((d) => d.from >= w.from && d.to <= w.to);
  const combined: Row[] = weekCols.flatMap((w) => [weekRow(w), ...inWeek(w).map((d) => dayRow(d, true))]);
  return (
    <>
      {showChart && <Section title={"Trend (" + (gran === "day" ? "day by day" : "week by week") + ")"}>
        <div className="flex justify-end">
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
            {([["day", "Daily"], ["week", "Weekly"]] as const).map(([k, l]) => (
              <button key={k} type="button" disabled={k === "day" && dayCols.length === 0} onClick={() => setGran(k)} className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-40 ${gran === k ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"}`}>{l}</button>
            ))}
          </div>
        </div>
        <LargeTrendChart defs={chartDefs} values={values} cols={gran === "day" ? dayCols : weekCols} />
      </Section>}
      <Section title={"Overall (" + mtdLabel + ")"}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {defs.map((d, i) => <Stat key={d.key} label={d.label} value={overall[i]} />)}
        </div>
      </Section>
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PeriodModeToggle mode={mode} onChange={setMode} />
          <DrawerExcelButton fileBase={fileBase} getSheets={sheets} />
        </div>
        {mode === "week" && <DataTable head={["Week", ...head]} rows={weekCols.map((c) => dayRow(c))} />}
        {mode === "date" && <DataTable head={["Date", ...head]} rows={dayCols.map((c) => dayRow(c))} />}
        {mode === "combined" && <DataTable head={["Week / Date", ...head]} rows={combined} />}
      </section>
    </>
  );
}
function DataTable({ head, rows }: { head: string[]; rows: Row[] }) {
  if (rows.length === 0) return <None />;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-100">
      <table className="w-full text-center text-xs">
        <thead>
          <tr className="bg-slate-800 text-[10px] font-bold uppercase tracking-wide text-white">
            {head.map((h) => <th key={h} className="whitespace-nowrap px-2.5 py-2">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.key} onClick={r.onClick} role={r.onClick ? "button" : undefined} tabIndex={r.onClick ? 0 : undefined}
              className={`${i % 2 === 1 ? "bg-slate-50/70" : "bg-white"} ${r.onClick ? "cursor-pointer transition-colors hover:bg-indigo-50/60" : ""}`}
            >
              {r.cells.map((c, j) => <td key={j} className={`whitespace-nowrap px-2.5 py-2 ${j === 0 ? "font-semibold text-slate-700" : "text-slate-600"}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Dedicated fetch of the per-agent rows for a date window (the existing /agent-wise endpoint). */
function useAgentRows(from: string, to: string): { rows: HPAgentPerfRow[] | null; error: string } {
  const [rows, setRows] = useState<HPAgentPerfRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setRows(null); setError("");
    hrmsApi.get<{ success: boolean; data: HPAgentWiseData }>(`${HP_API}/agent-wise?from=${from}&to=${to}`)
      .then((res) => { if (!cancelled) setRows(res.data.agents); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the agents."); });
    return () => { cancelled = true; };
  }, [from, to]);
  return { rows, error };
}

function AgentsSection({
  from, to, filter, agentScope, onOpenAgent,
}: { from: string; to: string; filter?: (a: HPAgentPerfRow) => boolean; agentScope: string | null; onOpenAgent: (n: string) => void }) {
  const { rows, error } = useAgentRows(from, to);
  const shown = useMemo(() => {
    let list = rows ?? [];
    if (agentScope) list = list.filter((a) => a.name.toLowerCase() === agentScope.toLowerCase());
    if (filter) list = list.filter(filter);
    return [...list].sort((a, b) => b.revenue - a.revenue);
  }, [rows, filter, agentScope]);
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div>;
  if (!rows) return <div className="flex justify-center py-6 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  return (
    <DataTable
      head={["Agent", "TL", "Calls", "Connected %", "Sales", "Revenue", "Ach%"]}
      rows={shown.map((a) => ({
        key: a.name, onClick: () => onOpenAgent(a.name),
        cells: [a.name, a.tlName, fmtN(a.totalCalls), `${a.connectedPct}%`, fmtN(a.saleCount), formatINR(a.revenue), `${Math.round(a.achievedPct)}%`],
      }))}
    />
  );
}

/**
 * One right-side drill-down for everything clickable on the Housing Premium
 * Outbound dashboard: a metric (its day/week/TL breakdown), a single day or
 * week (every metric for it, per TL, plus the agents behind it), or a TL
 * (its weeks, days and agents). Metric/period/TL figures come from the same
 * overview payload the dashboard already holds; the agent lists are a
 * dedicated fetch of /agent-wise for the exact window.
 */
export function HousingPremiumDrilldownDrawer({
  target, columns, values, byTl, scopeLabel, agentScope, from, to, onDrill, onOpenAgent, onClose,
}: {
  target: HpDrillTarget; columns: HPColumn[]; values: Record<string, HPOverviewValues>; byTl: TlBlock[];
  scopeLabel: string; agentScope: string | null; from: string; to: string;
  onDrill: (t: HpDrillTarget) => void; onOpenAgent: (name: string) => void; onClose: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [matrixTl, setMatrixTl] = useState<string>(target.kind === "matrix" ? target.tlName ?? "all" : "all");
  useEffect(() => { if (target.kind === "matrix") setMatrixTl(target.tlName ?? "all"); }, [target]);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mtd = columns.find((c) => c.kind === "mtd");
  const dayCols = columns.filter((c) => c.kind === "day");
  const weekCols = columns.filter((c) => c.kind === "week");

  let eyebrow = ""; let title = ""; let subtitle = ""; let body: ReactNode = null;

  if (target.kind === "metric") {
    const def = METRIC_BY_KEY.get(target.key)!;
    const fmt = (v: number | undefined) => fmtMetric(v, def.fmt);
    eyebrow = "Housing Premium · Metric"; title = def.label; subtitle = `${scopeLabel} · ${fmtDate(from)} to ${fmtDate(to)}`;
    const dayVals = dayCols.map((c) => ({ col: c, v: values[c.key]?.[target.key] ?? 0 }));
    const peak = dayVals.length ? dayVals.reduce((a, b) => (b.v > a.v ? b : a)) : null;
    const low = dayVals.length ? dayVals.reduce((a, b) => (b.v < a.v ? b : a)) : null;
    const chartCols = dayCols.length > 0 ? dayCols : weekCols;
    const chartData = chartCols.map((c) => ({ label: c.label, value: values[c.key]?.[target.key] ?? 0 }));
    body = (
      <>
        <Section title="This range">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label={mtd?.label ?? "Range"} value={fmt(values.mtd?.[target.key])} />
            <Stat label="Peak day" value={peak ? fmt(peak.v) : "—"} sub={peak?.col.label} />
            <Stat label="Lowest day" value={low ? fmt(low.v) : "—"} sub={low?.col.label} />
          </div>
          <p className="rounded-lg bg-indigo-50/70 px-3 py-2 text-[11px] leading-relaxed text-indigo-800"><b>How it is calculated:</b> {def.help}</p>
        </Section>
        <Section title={dayCols.length > 0 ? "Day by day" : "Week by week"}>
          {chartData.length === 0 ? <None /> : (
            <ResponsiveContainer width="100%" height={170}>
              <ComposedChart data={chartData} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip {...TOOLTIP_PROPS} formatter={(v: number) => fmt(Number(v))} />
                <Bar dataKey="value" name={def.label} fill="#a5b4fc" radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="value" name={def.label} stroke="#4f46e5" strokeWidth={2} dot={false} legendType="none" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </Section>
        {byTl.length > 0 && (
          <Section title="By TL">
            <DataTable
              head={["TL", "Agents", def.label]}
              rows={byTl.map((t) => ({ key: t.tlName, onClick: () => onDrill({ kind: "tl", tlName: t.tlName }), cells: [t.tlName, fmtN(t.agentCount), fmt(t.values.mtd?.[target.key])] }))}
            />
          </Section>
        )}
        <Section title="Week by week">
          <DataTable
            head={["Week", "From – To", def.label]}
            rows={weekCols.map((c) => ({ key: c.key, onClick: () => onDrill({ kind: "period", colKey: c.key }), cells: [c.label, `${fmtDate(c.from)} – ${fmtDate(c.to)}`, fmt(values[c.key]?.[target.key])] }))}
          />
        </Section>
        {dayCols.length > 0 && (
          <Section title="Day by day">
            <DataTable
              head={["Date", def.label]}
              rows={dayCols.map((c) => ({ key: c.key, onClick: () => onDrill({ kind: "period", colKey: c.key }), cells: [c.label, fmt(values[c.key]?.[target.key])] }))}
            />
          </Section>
        )}
      </>
    );
  } else if (target.kind === "group") {
    const defs = target.keys.map((k) => METRIC_BY_KEY.get(k)!);
    eyebrow = "Housing Premium · Card details"; title = target.title; subtitle = `${scopeLabel} · ${fmtDate(from)} to ${fmtDate(to)}`;
    const raw = (c: HPColumn) => defs.map((d) => values[c.key]?.[d.key] ?? 0);
    const shownRow = (c: HPColumn) => defs.map((d) => fmtMetric(values[c.key]?.[d.key], d.fmt));
    const sheets = (): DrawerSheet[] => [
      { name: "Overall", columns: ["Metric", "Value"], rows: defs.map((d) => [d.label, fmtMetric(values.mtd?.[d.key], d.fmt)]) },
      { name: "Week-wise", columns: ["Week", "From", "To", ...defs.map((d) => d.label)], rows: weekCols.map((c) => [c.label, c.from, c.to, ...raw(c)]) },
      { name: "Date-wise", columns: ["Date", ...defs.map((d) => d.label)], rows: dayCols.map((c) => [c.label, ...raw(c)]) },
    ];
    body = (
      <GroupBody
        defs={defs} mtdLabel={mtd?.label ?? "Range"} overall={defs.map((d) => fmtMetric(values.mtd?.[d.key], d.fmt))}
        weekCols={weekCols} dayCols={dayCols} shownRow={shownRow} sheets={sheets} fileBase={`Housing_Premium_${target.title}`}
        onPeriod={(colKey) => onDrill({ kind: "period", colKey })} chartDefs={defs} values={values}
      />
    );
  } else if (target.kind === "matrix") {
    const tlPick = matrixTl !== "all" ? byTl.find((t) => t.tlName === matrixTl) : undefined;
    const mv = tlPick ? tlPick.values : values;
    const defs = METRICS;
    const scopeName = tlPick ? tlPick.tlName : scopeLabel;
    eyebrow = "Housing Premium · Performance details"; title = target.title; subtitle = `${scopeName} · ${fmtDate(from)} to ${fmtDate(to)}`;
    const raw = (c: HPColumn) => defs.map((d) => mv[c.key]?.[d.key] ?? 0);
    const shownRow = (c: HPColumn) => defs.map((d) => fmtMetric(mv[c.key]?.[d.key], d.fmt));
    const sheets = (): DrawerSheet[] => [
      { name: "Overall", columns: ["Metric", "Value"], rows: defs.map((d) => [d.label, fmtMetric(mv.mtd?.[d.key], d.fmt)]) },
      { name: "Week-wise", columns: ["Week", "From", "To", ...defs.map((d) => d.label)], rows: weekCols.map((c) => [c.label, c.from, c.to, ...raw(c)]) },
      { name: "Date-wise", columns: ["Date", ...defs.map((d) => d.label)], rows: dayCols.map((c) => [c.label, ...raw(c)]) },
    ];
    body = (
      <>
        {byTl.length > 0 && (
          <Section title="Filter">
            <label className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
              TL
              <select value={matrixTl} onChange={(e) => setMatrixTl(e.target.value)} aria-label="Filter by TL" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm focus:border-indigo-400 focus:outline-none">
                <option value="all">All TLs ({scopeLabel})</option>
                {byTl.map((t) => <option key={t.tlName} value={t.tlName}>{t.tlName} ({t.agentCount})</option>)}
              </select>
            </label>
          </Section>
        )}
        <GroupBody
          key={matrixTl} defs={defs} mtdLabel={mtd?.label ?? "Range"} overall={defs.map((d) => fmtMetric(mv.mtd?.[d.key], d.fmt))}
          weekCols={weekCols} dayCols={dayCols} shownRow={shownRow} sheets={sheets} fileBase={`Housing_Premium_${target.title}_${scopeName}`}
          onPeriod={(colKey) => onDrill({ kind: "period", colKey })} chartDefs={defs} values={mv} showChart={false}
        />
      </>
    );
  } else if (target.kind === "period") {
    const col = columns.find((c) => c.key === target.colKey);
    eyebrow = `Housing Premium · ${col?.kind === "week" ? "Week" : col?.kind === "day" ? "Day" : "Period"}`;
    title = col?.label ?? target.colKey;
    subtitle = col ? `${scopeLabel} · ${fmtDate(col.from)} to ${fmtDate(col.to)}` : scopeLabel;
    const v = values[target.colKey];
    body = (
      <>
        <Section title="All metrics">
          {!v ? <None /> : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {METRICS.map((m) => <Stat key={m.key} label={m.label} value={fmtMetric(v[m.key], m.fmt)} />)}
            </div>
          )}
        </Section>
        {byTl.length > 0 && (
          <Section title="By TL">
            <DataTable
              head={["TL", "Calls", "Connected %", "Sales", "Revenue", "Ach%"]}
              rows={byTl.map((t) => {
                const tv = t.values[target.colKey];
                return { key: t.tlName, onClick: () => onDrill({ kind: "tl", tlName: t.tlName }), cells: [t.tlName, fmtN(tv?.totalCalls ?? 0), `${tv?.connectedPct ?? 0}%`, fmtN(tv?.saleCount ?? 0), formatINR(tv?.revenue ?? 0), `${Math.round(tv?.achievedPct ?? 0)}%`] };
              })}
            />
          </Section>
        )}
        {col && (
          <Section title="Agents in this period">
            <AgentsSection from={col.from} to={col.to} agentScope={agentScope} onOpenAgent={onOpenAgent} />
          </Section>
        )}
      </>
    );
  } else {
    const tl = byTl.find((t) => t.tlName === target.tlName);
    eyebrow = "Housing Premium · TL"; title = target.tlName; subtitle = `${tl?.agentCount ?? 0} agents · ${fmtDate(from)} to ${fmtDate(to)}`;
    const tv = tl?.values ?? {};
    const compact = (c: HPColumn): Row => {
      const x = tv[c.key];
      return { key: c.key, cells: [c.label, fmtN(x?.totalCalls ?? 0), `${x?.connectedPct ?? 0}%`, fmtN(x?.saleCount ?? 0), formatINR(x?.revenue ?? 0), `${Math.round(x?.achievedPct ?? 0)}%`] };
    };
    const head = ["Period", "Calls", "Connected %", "Sales", "Revenue", "Ach%"];
    body = (
      <>
        <Section title="This range">
          {!tv.mtd ? <None /> : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {METRICS.filter((m) => ["totalCalls", "connectedPct", "saleCount", "revenue", "achievedPct", "aov"].includes(m.key)).map((m) => <Stat key={m.key} label={m.label} value={fmtMetric(tv.mtd[m.key], m.fmt)} />)}
            </div>
          )}
        </Section>
        <Section title="Week by week"><DataTable head={head} rows={weekCols.map(compact)} /></Section>
        {dayCols.length > 0 && <Section title="Day by day"><DataTable head={head} rows={dayCols.map(compact)} /></Section>}
        <Section title="Agents">
          <AgentsSection from={from} to={to} agentScope={agentScope} filter={(a) => a.tlName === target.tlName} onOpenAgent={onOpenAgent} />
        </Section>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button" aria-label="Close detail" onClick={onClose}
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <aside className={`relative flex h-full w-full ${target.kind === "group" || target.kind === "matrix" ? "max-w-4xl" : "max-w-2xl"} flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <header className="flex items-start justify-between gap-3 bg-gradient-to-br from-indigo-700 via-blue-700 to-indigo-800 px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/75">{eyebrow}</p>
            <h3 className="truncate text-lg font-bold">{title}</h3>
            <p className="mt-0.5 text-[11px] text-white/80">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/85 transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">{body}</div>
      </aside>
    </div>
  );
}

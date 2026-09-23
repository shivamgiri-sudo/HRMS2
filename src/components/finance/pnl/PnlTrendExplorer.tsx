import { useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Area, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Info, LineChart as LineChartIcon, Table as TableIcon } from "lucide-react";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { costCentreText } from "./costCentreLabel";
import { pnlLabel } from "./pnlLabels";
import { usePnlTrendSeries, type TrendGrain, type TrendPoint, type TrendScopeType } from "@/hooks/usePnlTrendSeries";

/**
 * P&L trend — revenue vs salary + IDC, and OP%, by day / week / month for the company, a branch or
 * a cost centre. Built on the Live P&L (see pnl-trend-series.service.ts), so it agrees with the
 * headline strip and the Live P&L tab.
 *
 * Two aligned charts, never one dual-axis plot: rupees on top, OP% below, sharing the time axis
 * and one synced crosshair. Estimated (seat-rate) revenue is dashed; buckets still in progress are
 * drawn lighter; periods with no people cost leave a gap in OP% rather than a fake ~100%.
 * Palette validated (dataviz validator) on the app's light card (#fff) and dark card (#1d283a).
 */

const CHART_CONFIG = {
  revenue: { label: pnlLabel("RECOGNISED_REVENUE"), theme: { light: "#2a78d6", dark: "#3987e5" } },
  salary: { label: pnlLabel("PEOPLE_COST"), theme: { light: "#eb6834", dark: "#d95926" } },
  idc: { label: pnlLabel("INDIRECT_COST"), theme: { light: "#1baf7a", dark: "#199e70" } },
  positive: { label: "Positive margin", theme: { light: "#2a78d6", dark: "#3987e5" } },
  negative: { label: "Negative margin", theme: { light: "#e34948", dark: "#e66767" } },
} satisfies ChartConfig;

const GRAINS: Array<{ value: TrendGrain; label: string }> = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];
const SCOPES: Array<{ value: TrendScopeType; label: string }> = [
  { value: "company", label: "Company" },
  { value: "branch", label: "Branch" },
  { value: "cost_centre", label: "Cost centre" },
];
const RANGES: Record<Exclude<TrendGrain, "day">, number[]> = { week: [8, 13, 26], month: [6, 12] };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ₹ in Indian units: 2.74 Cr, 45.3 L, 8,500. */
export function inrCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const v = Math.abs(value);
  if (v >= 1e7) return `${sign}₹${(v / 1e7).toFixed(v >= 1e9 ? 0 : 2)} Cr`;
  if (v >= 1e5) return `${sign}₹${(v / 1e5).toFixed(1)} L`;
  return `${sign}₹${Math.round(v).toLocaleString("en-IN")}`;
}
const pctLabel = (v: number | null | undefined) => (v == null ? "NA" : `${v.toFixed(1)}%`);
/** Axis ticks: short enough never to wrap (₹2.3Cr, ₹75L, ₹8K). */
const axisInr = (v: number) => {
  const a = Math.abs(v), sign = v < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${sign}₹${Math.round(a / 1e5)}L`;
  if (a >= 1e3) return `${sign}₹${Math.round(a / 1e3)}K`;
  return `${sign}₹${Math.round(a)}`;
};
/** Series colours as CSS variables on the whole card, so the legend (outside the chart
 *  containers) and the charts read the same validated values in light and dark mode. */
const ROOT_VARS = `
[data-pnl-trend] { --color-revenue:#2a78d6; --color-salary:#eb6834; --color-idc:#1baf7a; --color-positive:#2a78d6; --color-negative:#e34948; }
.dark [data-pnl-trend] { --color-revenue:#3987e5; --color-salary:#d95926; --color-idc:#199e70; --color-positive:#3987e5; --color-negative:#e66767; }`;
const periodLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]}-${p.slice(2, 4)}`;

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-border bg-muted/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition-colors duration-200 ${value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  const toneClass = tone === "good" ? "text-emerald-700 dark:text-emerald-400" : tone === "bad" ? "text-rose-700 dark:text-rose-400" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card/80 px-3 py-2.5">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-xl font-bold ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">{tone === "warn" && <AlertTriangle className="h-3 w-3 text-amber-600" />}{sub}</p>}
    </div>
  );
}

function LegendKey({ kind, colorVar, label }: { kind: "bar" | "line" | "dash"; colorVar: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {kind === "bar"
        ? <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: `var(${colorVar})` }} />
        : <svg width="18" height="6" aria-hidden><line x1="1" y1="3" x2="17" y2="3" stroke={`var(${colorVar})`} strokeWidth="2" strokeDasharray={kind === "dash" ? "4 3" : undefined} strokeLinecap="round" /></svg>}
      {label}
    </span>
  );
}

interface Row extends TrendPoint { revenueWithEstimate: number | null; estimateBand: [number, number] | null; opPos: number | null; opNeg: number | null; zero: number }

function TrendTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Row }> }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const lines: Array<{ key: string; label: string; value: string; colorVar?: string; dash?: boolean }> = [
    { key: "rev", label: pnlLabel("RECOGNISED_REVENUE"), value: inrCompact(row.revenue), colorVar: "--color-revenue" },
    ...(row.revenueEstimated > 0 ? [{ key: "est", label: "of which estimated", value: inrCompact(row.revenueEstimated), colorVar: "--color-revenue", dash: true }] : []),
    { key: "sal", label: row.salaryMissing ? `${pnlLabel("PEOPLE_COST")} (not run yet)` : pnlLabel("PEOPLE_COST"), value: row.salaryMissing ? "—" : inrCompact(row.salary), colorVar: "--color-salary" },
    { key: "idc", label: pnlLabel("INDIRECT_COST"), value: inrCompact(row.idc), colorVar: "--color-idc" },
    { key: "op", label: pnlLabel("OPERATING_PROFIT_CONTRIBUTION"), value: inrCompact(row.op) },
    { key: "pct", label: pnlLabel("OPERATING_MARGIN"), value: pctLabel(row.opPct) },
  ];
  return (
    <div className="min-w-52 rounded-xl border border-border bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
      <p className="mb-1.5 font-semibold text-foreground">
        {row.start === row.end || /^\d{4}-\d{2}$/.test(row.key) ? row.label : `Week of ${row.label} – ${Number(row.end.slice(8, 10))} ${MONTHS[Number(row.end.slice(5, 7)) - 1]}`}
        {row.isPartial && <span className="ml-1.5 font-normal text-muted-foreground">(to date)</span>}
      </p>
      {lines.map((l) => (
        <div key={l.key} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {l.colorVar
              ? <svg width="12" height="6" aria-hidden><line x1="1" y1="3" x2="11" y2="3" stroke={`var(${l.colorVar})`} strokeWidth="2" strokeDasharray={l.dash ? "3 2" : undefined} strokeLinecap="round" /></svg>
              : <span className="inline-block w-3" />}
            {l.label}
          </span>
          <span className="font-semibold tabular-nums text-foreground">{l.value}</span>
        </div>
      ))}
    </div>
  );
}

export function PnlTrendExplorer({ period, branchId }: { period: string; branchId?: string }) {
  const [grain, setGrain] = useState<TrendGrain>("month");
  const [scope, setScope] = useState<TrendScopeType>(branchId ? "branch" : "company");
  const [scopeId, setScopeId] = useState<string>(branchId ?? "");
  const [count, setCount] = useState<number>(6);
  const [showTable, setShowTable] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    try { setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch { /* default: animate */ }
  }, []);
  useEffect(() => { if (grain !== "day") setCount(RANGES[grain][0]); }, [grain]);
  useEffect(() => { if (branchId) { setScope("branch"); setScopeId(branchId); } }, [branchId]);

  const query = usePnlTrendSeries({ grain, scope, scopeId: scope === "company" ? undefined : scopeId || undefined, anchor: period, count: grain === "day" ? undefined : count });
  const data = query.data;
  const needsPick = scope !== "company" && !scopeId;

  const rows: Row[] = useMemo(() => {
    const pts = data?.points ?? [];
    return pts.map((p, i) => {
      // Solid line = invoiced revenue (always). Dashed line = total incl. the seat-rate estimate,
      // drawn where an estimate exists and joined to the point before it. The light band between
      // them IS the estimate — so an un-invoiced month shows the estimate carrying it, instead of
      // revenue appearing to collapse.
      const estimated = p.revenueEstimated > 0.5;
      const nextEstimated = (pts[i + 1]?.revenueEstimated ?? 0) > 0.5;
      const bridged = estimated || nextEstimated;
      return {
        ...p,
        label: p.isPartial ? `${p.label} · to date` : p.label,
        zero: 0,
        revenueWithEstimate: bridged ? p.revenue : null,
        estimateBand: bridged ? [estimated ? p.revenueActual : p.revenue, p.revenue] : null,
        opPos: p.opPct == null ? null : Math.max(p.opPct, 0),
        opNeg: p.opPct == null ? null : Math.min(p.opPct, 0),
      };
    });
  }, [data]);

  const branchOptions = (data?.options.branches ?? []).map((b) => ({ value: b.id, label: b.name }));
  const ccOptions = (data?.options.costCentres ?? []).map((c) => ({ value: c.id, label: costCentreText(c.code, c.processName ?? (c.name !== c.code ? c.name : null)), hint: c.branchName, keywords: `${c.code} ${c.processName ?? ""} ${c.name} ${c.branchName}` }));
  const t = data?.totals;
  // Tiles total only periods with every cost line: no payroll run yet, or no GRN recorded at all, is left out.
  const complete = rows.filter((r) => !r.salaryMissing && !r.idcMissing);
  const missingLabels = rows.filter((r) => r.salaryMissing || r.idcMissing).map((r) => r.label);
  const sumOf = (list: Row[], f: (r: Row) => number) => list.reduce((acc, r) => acc + f(r), 0);
  const knownRevenue = sumOf(complete, (r) => r.revenue);
  const knownCost = sumOf(complete, (r) => (r.salary ?? 0) + r.idc);
  const knownOp = complete.length ? knownRevenue - knownCost : null;
  const knownOpPct = knownOp == null || Math.abs(knownRevenue) < 0.5 ? null : (knownOp / knownRevenue) * 100;
  const opValues = rows.map((r) => r.opPct).filter((v): v is number => v != null);
  const opMin = opValues.length ? Math.min(...opValues) : 0;
  const opMax = opValues.length ? Math.max(...opValues) : 0;
  const opCapped = opMin < -100 || opMax > 100;
  // Round steps that always include 0% (5/10/20/25/50), capped at ±100%.
  const opLo = Math.max(Math.min(opMin, 0), -100);
  const opHi = Math.min(Math.max(opMax, 0), 100);
  const opStep = [5, 10, 20, 25, 50].find((st) => (opHi - opLo) / st <= 5) ?? 50;
  const opDomain: [number, number] = [Math.floor(opLo / opStep) * opStep, Math.ceil(opHi / opStep) * opStep || opStep];
  const opTicks = Array.from({ length: Math.round((opDomain[1] - opDomain[0]) / opStep) + 1 }, (_, i) => opDomain[0] + i * opStep);
  const excludedNote = missingLabels.length
    ? `excl. ${missingLabels.length > 2 ? `${missingLabels.length} periods` : missingLabels.join(", ")} (a cost line not recorded yet)`
    : undefined;
  const monthly = grain === "month";
  const rangeLabel = grain === "day" ? `Days of ${periodLabel(period)}` : `Last ${count} ${grain === "week" ? "weeks" : "months"} to ${periodLabel(period)}`;
  const dim = query.isFetching && Boolean(data);

  return (
    <section data-pnl-trend className="rounded-2xl border border-border bg-card/95 p-4 shadow-sm sm:p-5" aria-label="P&L trend">
      <style>{ROOT_VARS}</style>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-foreground">P&amp;L trend</h2>
          <p className="text-xs text-muted-foreground">{data?.scope.label ?? "MAS Callnet — company"} · {rangeLabel}</p>
        </div>
        <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          {showTable ? <><LineChartIcon className="mr-1.5 h-3.5 w-3.5" />Chart</> : <><TableIcon className="mr-1.5 h-3.5 w-3.5" />Table</>}
        </Button>
      </div>

      {/* One filter row, above everything it scopes. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented<TrendGrain> label="Grain" value={grain} options={GRAINS} onChange={setGrain} />
        <Segmented<TrendScopeType> label="Scope" value={scope} options={SCOPES} onChange={(v) => { setScope(v); setScopeId(v === "branch" && branchId ? branchId : ""); }} />
        {scope === "branch" && (
          <SearchableSelect className="w-56" options={branchOptions} value={scopeId} onChange={setScopeId} placeholder="Choose a branch" aria-label="Branch" />
        )}
        {scope === "cost_centre" && (
          <SearchableSelect className="w-72" options={ccOptions} value={scopeId} onChange={setScopeId} placeholder="Choose a cost centre" searchPlaceholder="Search code or name…" aria-label="Cost centre" />
        )}
        {grain !== "day" && (
          <Select value={String(count)} onValueChange={(v) => setCount(Number(v))}>
            <SelectTrigger className="h-9 w-36 rounded-xl text-xs" aria-label="Range"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGES[grain].map((c) => <SelectItem key={c} value={String(c)}>Last {c} {grain === "week" ? "weeks" : "months"}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {needsPick ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Choose a {scope === "branch" ? "branch" : "cost centre"} to see its trend.
        </p>
      ) : query.isLoading && !data ? (
        <div className="space-y-3"><div className="grid grid-cols-2 gap-2 md:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div><Skeleton className="h-72 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>
      ) : query.isError || !data ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          Could not load the trend. <button type="button" className="underline" onClick={() => void query.refetch()}>Retry</button>
        </div>
      ) : (
        <div className={`transition-opacity duration-200 ${dim ? "opacity-60" : ""}`}>
          <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
            <StatTile label={pnlLabel("RECOGNISED_REVENUE")} value={inrCompact(t?.revenue)} sub={(t?.revenueEstimated ?? 0) > 0 ? `incl. ${inrCompact(t?.revenueEstimated)} estimated` : undefined} tone={(t?.revenueEstimated ?? 0) > 0 ? "warn" : undefined} />
            <StatTile label={pnlLabel("PEOPLE_COST")} value={complete.length ? inrCompact(sumOf(complete, (r) => r.salary ?? 0)) : "Not run yet"} sub={excludedNote} tone={excludedNote ? "warn" : undefined} />
            <StatTile label={pnlLabel("INDIRECT_COST")} value={inrCompact(t?.idc)} />
            <StatTile label={pnlLabel("OPERATING_PROFIT_CONTRIBUTION")} value={inrCompact(knownOp)} sub={excludedNote} tone={knownOp == null ? undefined : knownOp >= 0 ? "good" : "bad"} />
            <StatTile label={pnlLabel("OPERATING_MARGIN")} value={pctLabel(knownOpPct)} sub={excludedNote ? "same periods as Operating Profit" : undefined} tone={knownOpPct == null ? undefined : knownOpPct >= 0 ? "good" : "bad"} />
          </div>

          {showTable ? (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
                  <tr>{["Period", pnlLabel("RECOGNISED_REVENUE"), "of which est.", pnlLabel("PEOPLE_COST"), pnlLabel("INDIRECT_COST"), pnlLabel("OPERATING_PROFIT_CONTRIBUTION"), pnlLabel("OPERATING_MARGIN")].map((h, i) => <th key={h} className={`px-3 py-2 ${i ? "text-right" : ""}`}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-t border-border">
                      <td className="px-3 py-1.5 font-medium text-foreground">{r.label}{r.isPartial ? " (to date)" : ""}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{inrCompact(r.revenue)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.revenueEstimated ? inrCompact(r.revenueEstimated) : "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.salaryMissing ? "Not run" : inrCompact(r.salary)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{inrCompact(r.idc)}</td>
                      <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${r.op == null ? "" : r.op >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>{inrCompact(r.op)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{pctLabel(r.opPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1" aria-hidden>
                <LegendKey kind="line" colorVar="--color-revenue" label="Revenue (invoiced)" />
                {rows.some((r) => r.revenueEstimated > 0.5) && <LegendKey kind="dash" colorVar="--color-revenue" label="Revenue incl. seat-rate estimate" />}
                <LegendKey kind="bar" colorVar="--color-salary" label="Salary cost" />
                <LegendKey kind="bar" colorVar="--color-idc" label="IDC (vendor / GRN)" />
              </div>
              <ChartContainer config={CHART_CONFIG} className="aspect-auto h-72 w-full" role="img" aria-label={`Revenue against salary and IDC cost, ${rangeLabel}`}>
                <ComposedChart data={rows} syncId="pnl-trend" margin={{ top: 12, right: 12, bottom: 0, left: 4 }} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeWidth={1} />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} tickMargin={8} minTickGap={16} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={axisInr} fontSize={11} />
                  <Tooltip content={<TrendTooltip />} cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.5 }} />
                  <Bar dataKey="salary" stackId="cost" fill="var(--color-salary)" stroke="hsl(var(--card))" strokeWidth={2} maxBarSize={24} isAnimationActive={!reduceMotion}>
                    {rows.map((r) => <Cell key={r.key} fillOpacity={r.isPartial ? 0.55 : 1} />)}
                  </Bar>
                  <Bar dataKey="idc" stackId="cost" fill="var(--color-idc)" stroke="hsl(var(--card))" strokeWidth={2} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={!reduceMotion}>
                    {rows.map((r) => <Cell key={r.key} fillOpacity={r.isPartial ? 0.55 : 1} />)}
                  </Bar>
                  <Line
                    type="monotone"
                    dataKey="revenueWithEstimate"
                    stroke="var(--color-revenue)"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    connectNulls={false}
                    dot={monthly ? ((props: { cx?: number; cy?: number; index?: number }) => {
                      const r = props.index == null ? undefined : rows[props.index];
                      if (!r || r.revenueEstimated <= 0.5 || props.cx == null || props.cy == null) return <g key={`e-${props.index}`} />;
                      return <circle key={`e-${props.index}`} cx={props.cx} cy={props.cy} r={4} fill="hsl(var(--card))" stroke="var(--color-revenue)" strokeWidth={2} />;
                    }) : false}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--color-revenue)", fill: "hsl(var(--card))" }}
                    isAnimationActive={!reduceMotion}
                  />
                  <Area type="monotone" dataKey="estimateBand" stroke="none" fill="var(--color-revenue)" fillOpacity={0.1} connectNulls={false} activeDot={false} isAnimationActive={!reduceMotion} />
                  <Line
                    type="monotone"
                    dataKey="revenueActual"
                    stroke="var(--color-revenue)"
                    strokeWidth={2}
                    strokeLinecap="round"
                    dot={monthly ? { r: 4, strokeWidth: 2, stroke: "hsl(var(--card))", fill: "var(--color-revenue)" } : false}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))", fill: "var(--color-revenue)" }}
                    isAnimationActive={!reduceMotion}
                  />
                </ComposedChart>
              </ChartContainer>

              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground">
                  {pnlLabel("OPERATING_MARGIN")}
                  {opCapped && <span className="ml-2 font-normal text-muted-foreground">axis capped at ±100% — hover or open the table for exact values</span>}
                </p>
                <span className="flex items-center gap-3">
                  <LegendKey kind="bar" colorVar="--color-positive" label="Above zero" />
                  <LegendKey kind="bar" colorVar="--color-negative" label="Below zero" />
                </span>
              </div>
              <ChartContainer config={CHART_CONFIG} className="aspect-auto h-40 w-full" role="img" aria-label={`Operating margin percentage, ${rangeLabel}`}>
                <ComposedChart data={rows} syncId="pnl-trend" margin={{ top: 8, right: 12, bottom: 0, left: 4 }} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeWidth={1} />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} tickMargin={8} minTickGap={16} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => `${v}%`} fontSize={11} domain={opDomain} ticks={opTicks} allowDataOverflow />
                  <Tooltip content={() => null} cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.5 }} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeWidth={1} />
                  {/* Invisible bar: gives this chart the same band x-scale as the columns above,
                      so each period sits directly under its column. */}
                  <Bar dataKey="zero" fill="transparent" maxBarSize={24} isAnimationActive={false} />
                  <Area type="monotone" dataKey="opPos" stroke="none" fill="var(--color-positive)" fillOpacity={0.12} connectNulls={false} activeDot={false} isAnimationActive={!reduceMotion} />
                  <Area type="monotone" dataKey="opNeg" stroke="none" fill="var(--color-negative)" fillOpacity={0.12} connectNulls={false} activeDot={false} isAnimationActive={!reduceMotion} />
                  <Line
                    type="monotone"
                    dataKey="opPct"
                    stroke="hsl(var(--foreground))"
                    strokeWidth={2}
                    connectNulls={false}
                    dot={monthly ? { r: 4, strokeWidth: 2, stroke: "hsl(var(--card))", fill: "hsl(var(--foreground))" } : false}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))", fill: "hsl(var(--foreground))" }}
                    isAnimationActive={!reduceMotion}
                  />
                </ComposedChart>
              </ChartContainer>
            </>
          )}

          {data.notes.length > 0 && (
            <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
              {data.notes.map((note) => (
                <li key={note} className="flex items-start gap-1.5"><Info className="mt-0.5 h-3 w-3 shrink-0" />{note}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

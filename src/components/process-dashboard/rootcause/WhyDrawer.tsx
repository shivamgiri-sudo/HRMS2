import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, Cell, CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Drawer } from "../Drawer";
import { formatValue } from "../format";
import { Empty, ErrorBox, FOCUS, Panel, Skeleton, reduceMotion } from "../ui";
import { fetchWhy } from "./api";
import { changeText, rangeText } from "./format";
import { WHY_DIMENSIONS, type WhyDimension, type WhyResponse, type WhySegment } from "./types";
import { buildWaterfall } from "./waterfall";
import { compareRange, dayCount, weekCompareValid, type Cmp, type WhyState } from "./whyState";

const GOOD = "#059669", BAD = "#dc2626", NEUTRAL = "#64748b", TOTAL = "#2563eb";
const field = `min-h-[36px] rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 ${FOCUS}`;
const CMP_LABEL: Record<Cmp, string> = { prev: "Previous period", week: "Same weekday last week", custom: "Custom dates" };

export interface WhyDims { tl: boolean; lob: boolean; hour: boolean }
export interface WhyDrawerProps {
  processId: string; state: WhyState; scope: { tl: string; lob: string }; dims: WhyDims; metricLabel?: string;
  onChange: (patch: Partial<WhyState>) => void; onClose: () => void; onPick: (seg: WhySegment, dim: WhyDimension) => void;
}

export function WhyDrawer({ processId, state, scope, dims, metricLabel, onChange, onClose, onPick }: WhyDrawerProps) {
  const base = compareRange(state);
  const weekOk = weekCompareValid(state.from, state.to);
  const q = useQuery({
    queryKey: ["process-dashboard", processId, "why", state.metric, state.by, state.from, state.to, base.from, base.to, scope.tl, scope.lob],
    queryFn: () => fetchWhy(processId, { metric: state.metric, by: state.by, from: state.from, to: state.to, compareFrom: base.from, compareTo: base.to, tl: scope.tl, lob: scope.lob }),
    staleTime: 10_000, retry: false,
  });
  const avail = (d: WhyDimension) => d === "agent" || dims[d] && !(d === "hour" && state.metric === "qa_score");
  return (
    <Drawer title={`Why did ${q.data?.metric.label ?? metricLabel ?? state.metric} change?`} subtitle={`${rangeText({ from: state.from, to: state.to })} versus ${rangeText(base)}`} onClose={onClose}>
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Break the change down by" className="flex flex-wrap gap-1.5">
          {WHY_DIMENSIONS.map((d) => { const on = state.by === d.key; const ok = avail(d.key);
            return <button key={d.key} type="button" aria-pressed={on} disabled={!ok} title={ok ? undefined : "Not available for this process or metric"} onClick={() => onChange({ by: d.key })}
              className={`min-h-[36px] cursor-pointer rounded-full border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS} ${on ? "border-blue-700 bg-blue-50 text-blue-900" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>{d.label}</button>; })}
        </div>
        <label className="text-xs font-semibold text-slate-700">Compare with
          <select value={state.cmp} onChange={(e) => onChange({ cmp: e.target.value as Cmp, ...(e.target.value === "custom" && !state.cf ? { cf: base.from, ct: base.to } : {}) })} className={`ml-2 cursor-pointer ${field}`}>
            {(Object.keys(CMP_LABEL) as Cmp[]).map((c) => <option key={c} value={c} disabled={c === "week" && !weekOk}>{CMP_LABEL[c]}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-xs font-semibold text-slate-700">
        <label>Current from <input type="date" value={state.from} max={state.to} onChange={(e) => e.target.value && onChange({ from: e.target.value })} className={field} /></label>
        <label>to <input type="date" value={state.to} min={state.from} onChange={(e) => e.target.value && onChange({ to: e.target.value })} className={field} /></label>
        {state.cmp === "custom" && (<>
          <label>Baseline from <input type="date" value={state.cf || base.from} onChange={(e) => e.target.value && onChange({ cf: e.target.value, ct: state.ct || e.target.value })} className={field} /></label>
          <label>to <input type="date" value={state.ct || base.to} onChange={(e) => e.target.value && onChange({ ct: e.target.value, cf: state.cf || e.target.value })} className={field} /></label>
        </>)}
      </div>
      {q.isLoading ? <><Skeleton className="h-24" /><Skeleton className="h-64" /></>
        : q.isError ? <ErrorBox message={q.error instanceof Error ? q.error.message : "Could not load the breakdown."} onRetry={() => void q.refetch()} />
        : q.data ? <WhyBody data={q.data} onPick={onPick} dayNote={dayCount(state.from, state.to) === 1 && state.cmp === "week"} /> : <Empty>No data.</Empty>}
    </Drawer>
  );
}

const dimNoun = (d: WhyDimension) => (d === "tl" ? "Team leader" : d === "lob" ? "LOB" : d === "agent" ? "Agent" : "Hour");
const drillLabel = (d: WhyDimension, s: WhySegment) => (d === "agent" ? `Open agent ${s.label}` : d === "tl" ? `Filter the dashboard to team leader ${s.label}` : `Filter the dashboard to LOB ${s.label}`);
const drillable = (d: WhyDimension, s: WhySegment) => d !== "hour" && s.key !== "__other__" && s.key !== "__unattributed__" && s.key !== "Unassigned" && s.key !== "Unknown";

/** Presentational part (also rendered in tests): summary, waterfall, and the table that is the accessible equivalent of the chart. */
export function WhyBody({ data, onPick, dayNote = false }: { data: WhyResponse; onPick: (seg: WhySegment, dim: WhyDimension) => void; dayNote?: boolean }) {
  const { metric: m, total, segments } = data;
  const unit = m.unit;
  const bars = useMemo(() => buildWaterfall(segments, m.direction), [segments, m.direction]);
  const ratio = m.kind === "ratio";
  const colour = (g: boolean | null, kind: string) => (kind === "total" ? TOTAL : g === null ? NEUTRAL : g ? GOOD : BAD);
  const chartData = bars.map((b) => ({ ...b, range: [b.lo, b.hi] as [number, number], label: changeText(b.value, unit) }));
  const summary = `Waterfall of contributions to the change in ${m.label}, by ${dimNoun(data.dimension).toLowerCase()}. ${bars.map((b) => `${b.name} ${changeText(b.value, unit)}`).join("; ")}.`;
  return (
    <>
      <section aria-label="Summary" className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span><span className="text-xs text-slate-700">Baseline</span> <b className="tabular-nums">{formatValue(total.a, unit)}</b></span>
          <span><span className="text-xs text-slate-700">Current</span> <b className="tabular-nums">{formatValue(total.b, unit)}</b></span>
          <span><span className="text-xs text-slate-700">Change</span> <b className="tabular-nums">{changeText(total.delta, unit)}{total.deltaPct != null ? ` (${total.deltaPct > 0 ? "+" : ""}${total.deltaPct.toFixed(1)}%)` : ""}</b></span>
        </div>
        <ul className="list-disc space-y-1 pl-5" aria-label="Plain-language explanation">{data.explanation.map((e, i) => <li key={i}>{e}</li>)}</ul>
        {dayNote && <p className="text-xs text-slate-700">A single day is compared with the same weekday one week earlier.</p>}
        <p className={`text-xs ${data.sumCheck.ok ? "text-slate-700" : "font-bold text-red-800"}`}>
          {data.sumCheck.sum === null ? "No change to attribute." : data.sumCheck.ok ? `Check: the contributions add up to the total change (${changeText(data.sumCheck.sum, unit)}).` : "Warning: contributions do not add up to the total change."}
        </p>
        {data.warnings.map((w) => <p key={w} className="text-xs font-semibold text-amber-900">{w}</p>)}
      </section>
      {total.delta !== null && bars.length > 1 && (
        <Panel title="Contribution to the change">
          <div role="img" aria-label={summary} className="w-full" style={{ height: Math.max(180, bars.length * 34 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 56, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => changeText(v as number, unit).replace(/^\+/, "")} />
                <YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 11 }} interval={0} />
                <ReferenceLine x={0} stroke="#475569" />
                <Tooltip formatter={(_v, _n, p) => changeText((p.payload as { value: number }).value, unit)} />
                <Bar dataKey="range" isAnimationActive={!reduceMotion()} radius={2}>
                  {chartData.map((b) => <Cell key={b.key} fill={colour(b.good, b.kind)} />)}
                  <LabelList dataKey="label" position="right" style={{ fontSize: 11, fill: "#0f172a" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-slate-600">Green moved {m.label} the favourable way, red the unfavourable way; the last bar is the total change. The table below has the same numbers.</p>
        </Panel>
      )}
      <Panel title={`By ${dimNoun(data.dimension).toLowerCase()}`}>
        {segments.length === 0 ? <Empty>No segments with data in either period.</Empty> : (
          <div className="overflow-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <caption className="sr-only">{`Contribution of each ${dimNoun(data.dimension).toLowerCase()} to the change in ${m.label}`}</caption>
              <thead className="bg-slate-50 text-slate-700"><tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">{dimNoun(data.dimension)}</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Baseline</th><th scope="col" className="px-3 py-2 text-right font-semibold">Current</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Contribution</th><th scope="col" className="px-3 py-2 text-right font-semibold">% of change</th>
                {ratio && <><th scope="col" className="px-3 py-2 text-right font-semibold">Rate effect</th><th scope="col" className="px-3 py-2 text-right font-semibold">Mix effect</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">{`Volume (${data.volumeUnit})`}</th></>}
                <th scope="col" className="px-3 py-2 text-left font-semibold">Note</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {segments.map((s) => (
                  <tr key={s.key} className="hover:bg-slate-50">
                    <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-semibold text-slate-900">
                      {drillable(data.dimension, s)
                        ? <button type="button" onClick={() => onPick(s, data.dimension)} aria-label={drillLabel(data.dimension, s)} className={`cursor-pointer rounded font-semibold text-blue-800 underline-offset-2 hover:underline ${FOCUS}`}>{s.label}</button>
                        : s.label}
                    </th>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{formatValue(s.a, unit)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{formatValue(s.b, unit)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums">{changeText(s.contribution, unit)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{s.contributionPct === null ? "—" : `${s.contributionPct.toFixed(1)}%`}</td>
                    {ratio && <>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{changeText(s.rateEffect, unit)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{changeText(s.mixEffect, unit)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{s.key === "__unattributed__" ? "—" : `${formatValue(s.volumeA)} → ${formatValue(s.volumeB)}`}</td></>}
                    <td className="whitespace-nowrap px-3 py-1.5 text-left text-slate-700">
                      {s.lowSample ? <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-900 ring-1 ring-amber-200">Low volume</span> : s.status === "new" ? "New" : s.status === "gone" ? "No longer present" : ""}
                    </td>
                  </tr>))}
              </tbody>
              <tfoot className="bg-slate-50 font-bold text-slate-900"><tr>
                <th scope="row" className="px-3 py-2 text-left">Total</th>
                <td className="px-3 py-2 text-right tabular-nums">{formatValue(total.a, unit)}</td><td className="px-3 py-2 text-right tabular-nums">{formatValue(total.b, unit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{changeText(total.delta, unit)}</td><td className="px-3 py-2 text-right tabular-nums">{total.delta === null || total.delta === 0 ? "—" : "100.0%"}</td>
                {ratio && <td colSpan={3} />}<td />
              </tr></tfoot>
            </table>
          </div>)}
        <p className="mt-2 text-[11px] text-slate-600">{ratio ? `Rate effect: the segment's own ${m.label} moved. Mix effect: the segment's share of ${data.volumeUnit} moved. ` : ""}{data.segmentCount > segments.length ? `Showing the ${segments.length - 1} largest of ${data.segmentCount}. ` : ""}Click a name to drill in.</p>
      </Panel>
    </>
  );
}

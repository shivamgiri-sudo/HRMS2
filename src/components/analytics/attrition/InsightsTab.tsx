import { useMemo, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS_TICK, ChartCard, ChartSkeleton, CoverageNote, EmptyState, GRID_PROPS, SERIES, STATUS, TOOLTIP_STYLE, num, pct,
} from "@/components/analytics/analytics-kit";
import { useHubInsights, useHubOverview } from "./api";
import { ChartKeyNav, DRILL_FOCUS, ErrorCard, Segmented, drillable, fmtMonth, fmtMonthLong } from "./charts";
import { useDrill } from "./DrillContext";
import { BatchHeatmap, OutlookCard, ReasonCapture, ScorecardCard } from "./InsightsExtras";
import type { AonBucketCounts, DrillQuery, Hotspot, HotspotDimension } from "./types";

const BUCKETS: (keyof AonBucketCounts)[] = ["0-30", "31-60", "61-90", "90+"];
const BUCKET_COLOR: Record<keyof AonBucketCounts, string> = { "0-30": SERIES[7], "31-60": SERIES[1], "61-90": SERIES[3], "90+": SERIES[2] };
const DIMS: { value: HotspotDimension; label: string }[] = [
  { value: "branch", label: "Branch" }, { value: "process", label: "Process" }, { value: "manager", label: "Manager" }, { value: "designation", label: "Designation" },
];

function TrendCard() {
  const q = useHubOverview();
  const drill = useDrill();
  const data = useMemo(() => (q.data?.trend ?? []).map(t => ({ ...t, ...t.byBucket, label: fmtMonth(t.month) })), [q.data]);
  return (
    <ChartCard
      title="12-month exit trend"
      subtitle="Exits per month stacked by how long the person had been here (AON bucket), with the annualised attrition rate on the right axis."
    >
      {q.isLoading ? <ChartSkeleton height={280} /> : q.error ? <ErrorCard what="the trend" error={q.error} onRetry={() => q.refetch()} /> : data.length === 0 ? <EmptyState label="No trend data" height={240} /> : (
        <div className="[&_.recharts-bar-rectangle]:cursor-pointer" role="img" aria-label={`Monthly exits and attrition rate for the last ${data.length} months`}>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis yAxisId="l" tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
              <YAxis yAxisId="r" orientation="right" tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} unit="%" />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number | string, k: string) => (k === "ratePct" ? [pct(Number(v)), "Attrition rate (annualised)"] : k === "headcount" ? [num(Number(v)), "Headcount"] : [num(Number(v)), `Exits ${k}d`])} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => (v === "ratePct" ? "Attrition % (right)" : v === "headcount" ? "Headcount" : `Exits at ${v}d`)} />
              {BUCKETS.map((b, i) => (
                <Bar key={b} yAxisId="l" dataKey={b} stackId="x" fill={BUCKET_COLOR[b]} radius={i === BUCKETS.length - 1 ? [6, 6, 0, 0] : 0} maxBarSize={36} isAnimationActive={false}
                  onClick={(d: { payload?: { month: string } & Record<string, number> }) => {
                    const row = d.payload; if (!row) return;
                    drill({ population: "exits", month: row.month, aonBucket: b, sort: "date", title: `Exits in ${fmtMonthLong(row.month)} at ${b} days - ${num(row[b] ?? 0)}` });
                  }} />
              ))}
              <Line yAxisId="r" type="monotone" dataKey="ratePct" stroke="#0f172a" strokeWidth={2.5} dot={{ r: 3, fill: "#0f172a" }} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <ChartKeyNav label="Month drill" items={data.map(t => ({ label: `Exits in ${fmtMonthLong(t.month)}`, onOpen: () => drill({ population: "exits", month: t.month, sort: "date", title: `Exits in ${fmtMonthLong(t.month)} - ${num(t.exits)}` }) }))} />
        </div>
      )}
    </ChartCard>
  );
}

const DIM_ID = { branch: "branchId", process: "processId", manager: "managerId", designation: "designationId" } as const;

function HotspotTable({ rows, avgRate, dim }: { rows: Hotspot[]; avgRate: number; dim: HotspotDimension }) {
  const drill = useDrill();
  const open = (r: Hotspot) => { if (r.id) drill({ population: "exits", windowDays: 90, sort: "date", [DIM_ID[dim]]: r.id, title: `Exits in ${r.label}, last 90 days - ${num(r.exits90)}` } as DrillQuery); };
  const max = Math.max(1, avgRate * 1.2, ...rows.map(r => r.ratePct ?? 0));
  if (rows.length === 0) return <EmptyState label="No groups with exits" height={120} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <th className="py-1.5 pr-2">Group</th><th className="px-2 text-right">People</th><th className="px-2 text-right">Exits 90d</th>
            <th className="w-52 px-2">Annualised rate (| = company)</th><th className="px-2 text-right">vs company</th><th className="px-2 text-right" title="Exits expected in 90 days given this group's tenure mix, at the company's own rates">Expected</th><th className="px-2 text-right" title="Exits minus expected: more exits than the tenure mix explains">Excess</th><th className="pl-2 text-right">High+Crit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const hot = (r.vsCompany ?? 0) >= 1.25;
            return (
              <tr key={r.id ?? r.label} {...(r.id ? { role: "button", tabIndex: 0, "aria-label": `Open exits for ${r.label}`, onClick: () => open(r), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(r); } } } : {})}
                className={`border-b border-slate-50 last:border-0 ${r.id ? `hover:bg-slate-50 ${DRILL_FOCUS}` : ""}`}>
                <td className="max-w-[200px] truncate py-2 pr-2 font-semibold text-slate-800">{r.label}</td>
                <td className="px-2 text-right tabular-nums text-slate-600">{num(r.headcount)}</td>
                <td className="px-2 text-right tabular-nums text-slate-600">{num(r.exits90)}</td>
                <td className="px-2">
                  <div className="flex items-center gap-2">
                    <div className="relative h-2.5 flex-1 rounded-full bg-slate-100" role="img" aria-label={r.ratePct === null ? "No rate" : `Rate ${r.ratePct.toFixed(1)} percent, company average ${avgRate.toFixed(1)} percent`}>
                      <div className="h-full rounded-full" style={{ width: `${((r.ratePct ?? 0) / max) * 100}%`, background: hot ? STATUS.critical : SERIES[0] }} />
                      <div className="absolute -top-0.5 h-3.5 w-0.5 bg-slate-800" style={{ left: `${(avgRate / max) * 100}%` }} aria-hidden />
                    </div>
                    <span className="w-12 text-right text-xs font-bold tabular-nums">{r.ratePct === null ? "n/a" : pct(r.ratePct, 0)}</span>
                  </div>
                </td>
                <td className={`px-2 text-right text-xs font-semibold tabular-nums ${hot ? "text-rose-700" : "text-slate-600"}`}>{r.vsCompany === null ? "n/a" : `${r.vsCompany.toFixed(1)}×`}{hot ? " ▲" : ""}</td>
                <td className="px-2 text-right text-xs tabular-nums text-slate-600">{r.expected90 === null ? "n/a" : r.expected90.toFixed(1)}</td>
                <td className="px-2 text-right text-xs font-bold tabular-nums">
                  {r.excess90 === null ? <span className="text-slate-400">n/a</span> : r.excess90 > 0
                    ? <span className="inline-flex items-center gap-0.5 text-rose-700"><ArrowUp className="h-3 w-3" aria-hidden />+{r.excess90.toFixed(1)}</span>
                    : <span className="text-emerald-700">{r.excess90.toFixed(1)}</span>}
                </td>
                <td className="pl-2 text-right tabular-nums">{r.highRisk > 0 ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">{r.highRisk}</span> : <span className="text-slate-400">0</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function InsightsTab() {
  const q = useHubInsights();
  const ov = useHubOverview();
  const drill = useDrill();
  const [dim, setDim] = useState<HotspotDimension>("branch");
  const avgRate = ov.data?.annualisedRatePct ?? 0;

  const exitTypeData = useMemo(() => {
    const e = q.data?.exitType;
    if (!e) return [];
    return [
      { name: "Voluntary", key: "voluntary" as const, value: e.voluntary, fill: SERIES[0] },
      { name: "Involuntary", key: "involuntary" as const, value: e.involuntary, fill: SERIES[1] },
      { name: "Not recorded", key: "unknown" as const, value: e.unknown, fill: "#cbd5e1" },
    ].filter(d => d.value > 0);
  }, [q.data]);
  const exitTotal = exitTypeData.reduce((s, d) => s + d.value, 0);
  const openType = (x: { name: string; key: "voluntary" | "involuntary" | "unknown"; value: number }) =>
    drill({ population: "exits", exitType: x.key, windowDays: 365, sort: "date", title: `${x.name} exits, last 12 months - ${num(x.value)}` });
  const openReason = (r: { reason: string; exits: number }) =>
    drill({ population: "exits", windowDays: 365, sort: "date", ...(r.reason === "Not recorded" ? { noReason: true } : { reason: r.reason }), title: `${r.reason === "Not recorded" ? "Exits with no reason recorded" : `Left for: ${r.reason}`} - ${num(r.exits)}` });
  const openTenure = (t: { bucket: string; exits: number }) => drill({ population: "exits", tenureBin: t.bucket, windowDays: 365, sort: "date", title: `Left after ${t.bucket} - ${num(t.exits)} exits` });

  if (q.error) return <div className="space-y-4"><TrendCard /><BatchHeatmap /><OutlookCard /><ErrorCard what="the insights" error={q.error} onRetry={() => q.refetch()} /></div>;
  const d = q.data;
  const reasons = (d?.reasons ?? []).slice(0, 10);
  const lowCoverage = d && (d.reasonCoveragePct ?? 0) < 50;

  return (
    <div className="space-y-4">
      <TrendCard />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <ChartCard title="How long people stayed before leaving" subtitle="Exits in the last 12 months by length of service at exit. A tall left side means an onboarding problem.">
          {!d ? <ChartSkeleton height={240} /> : d.tenureAtExit.every(t => t.exits === 0) ? <EmptyState label="No exits in the last 12 months" height={220} /> : (
            <div className="[&_.recharts-bar-rectangle]:cursor-pointer" role="img" aria-label={`Exits by tenure: ${d.tenureAtExit.map(t => `${t.bucket} ${t.exits}`).join(", ")}`}>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={d.tenureAtExit} margin={{ top: 16, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="bucket" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#f1f5f9" }} formatter={(v: number | string) => [num(Number(v)), "Exits"]} />
                  <Bar dataKey="exits" radius={[8, 8, 0, 0]} isAnimationActive={false} label={{ position: "top", fontSize: 11, fill: "#334155" }} onClick={(x: { payload?: { bucket: string; exits: number } }) => x.payload && openTenure(x.payload)}>
                    {d.tenureAtExit.map((t, i) => <Cell key={t.bucket} fill={i < 3 ? STATUS.critical : i < 5 ? SERIES[1] : SERIES[0]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <ChartKeyNav label="Tenure drill" items={d.tenureAtExit.map(t => ({ label: `Open ${t.bucket}`, onOpen: () => openTenure(t) }))} />
            </div>
          )}
        </ChartCard>

        <ChartCard title="Voluntary vs involuntary exits" subtitle="Share of exits in the last 12 months by exit type, as recorded.">
          {!d ? <ChartSkeleton height={240} /> : exitTotal === 0 ? <EmptyState label="No exits recorded" height={220} /> : (
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <div className="relative h-[200px] w-[200px] shrink-0 [&_.recharts-sector]:cursor-pointer" role="img" aria-label={`Exit type: ${exitTypeData.map(x => `${x.name} ${x.value}`).join(", ")}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={exitTypeData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} stroke="#fff" isAnimationActive={false} onClick={(x: { key?: string; payload?: { key: "voluntary" | "involuntary" | "unknown"; name: string; value: number } }) => { const p = x.payload ?? exitTypeData.find(e => e.key === x.key); if (p) openType(p as never); }}>
                      {exitTypeData.map(x => <Cell key={x.name} fill={x.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number | string, n: string) => [`${num(Number(v))} (${pct((Number(v) / exitTotal) * 100)})`, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-bold tabular-nums">{num(exitTotal)}</span><span className="text-[10px] uppercase tracking-wider text-slate-500">exits</span></div>
              </div>
              <ul className="w-full space-y-1.5 text-xs">
                {exitTypeData.map(x => (
                  <li key={x.name} {...drillable(() => openType(x), `Open ${x.value} ${x.name.toLowerCase()} exits`)} className={`-mx-1.5 flex items-center justify-between gap-3 rounded-md px-1.5 py-1 hover:bg-slate-50 ${DRILL_FOCUS}`}><span className="flex items-center gap-1.5 text-slate-700"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: x.fill }} />{x.name}</span><span className="tabular-nums text-slate-600"><strong className="text-slate-900">{num(x.value)}</strong> · {pct((x.value / exitTotal) * 100, 0)}</span></li>
                ))}
              </ul>
            </div>
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="Why people leave"
        subtitle="Exit reasons as recorded in the last 12 months."
        footer={d && (
          <CoverageNote shownGroups={reasons.length} distinctGroups={d.reasons.length} shownRecords={reasons.reduce((s, r) => s + r.exits, 0)}
            otherGroups={Math.max(0, d.reasons.length - reasons.length)} otherRecords={d.reasons.slice(10).reduce((s, r) => s + r.exits, 0)} unit="exits" />
        )}
      >
        {!d ? <ChartSkeleton height={220} /> : (
          <div className="space-y-3">
            {lowCoverage && (
              <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Only <strong className="tabular-nums">{d.reasonCoveragePct === null ? "an unknown share" : pct(d.reasonCoveragePct)}</strong> of exits have a recorded reason, so this chart shows what was written down, not why everyone left. Treat it as indicative only.
              </p>
            )}
            {d.reasonSources && d.reasonSources.legacy > 0 && (
              <p className="text-[11px] leading-snug text-slate-500">
                <span className="tabular-nums font-semibold text-slate-700">{num(d.reasonSources.exitRecord)}</span> from exit records,{" "}
                <span className="tabular-nums font-semibold text-slate-700">{num(d.reasonSources.legacy)}</span> from the legacy HRMS leaving reason (db_bill),{" "}
                <span className="tabular-nums font-semibold text-slate-700">{num(d.reasonSources.none)}</span> with none.
              </p>
            )}
            {reasons.length === 0 ? <EmptyState label="No reasons recorded" height={120} /> : (
              <div className="[&_.recharts-bar-rectangle]:cursor-pointer" role="img" aria-label={`Exit reasons: ${reasons.map(r => `${r.reason} ${r.exits}`).join(", ")}`}>
                <ResponsiveContainer width="100%" height={Math.max(160, reasons.length * 28)}>
                  <BarChart data={reasons} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 0 }}>
                    <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
                    <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="reason" width={140} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#f1f5f9" }} formatter={(v: number | string) => [num(Number(v)), "Exits"]} />
                    <Bar dataKey="exits" radius={[0, 6, 6, 0]} isAnimationActive={false} label={{ position: "right", fontSize: 11, fill: "#334155" }} onClick={(x: { payload?: { reason: string; exits: number } }) => x.payload && openReason(x.payload)}>
                      {reasons.map(r => <Cell key={r.reason} fill={r.reason === "Not recorded" ? "#cbd5e1" : SERIES[0]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <ChartKeyNav label="Reason drill" items={reasons.map(r => ({ label: `Open ${r.reason}`, onOpen: () => openReason(r) }))} />
              </div>
            )}
          </div>
        )}
      </ChartCard>

      <ReasonCapture />

      <ChartCard
        title="Hotspots"
        subtitle="Annualised attrition (last-90-day exits ×4 ÷ headcount) per group. The black tick marks the company rate; red means 1.25× the company or more. Excess = more exits than their tenure mix explains."
        action={<Segmented<HotspotDimension> label="Hotspot dimension" value={dim} onChange={setDim} options={DIMS} />}
      >
        {!d ? <ChartSkeleton height={200} /> : <HotspotTable rows={d.hotspots[dim] ?? []} avgRate={avgRate} dim={dim} />}
      </ChartCard>

      <BatchHeatmap />
      <ScorecardCard />
      <OutlookCard />

      <ChartCard title="Source of hire" subtitle="Joiners and exits by hiring source over the last 12 months; early-exit rate is the share of joiners who left within 90 days.">
        {!d ? <ChartSkeleton height={160} /> : d.monthlyBySource.length === 0 ? <EmptyState label="No source data" height={120} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-1.5 pr-2">Source</th><th className="px-2 text-right">Joiners</th><th className="px-2 text-right">Exits</th><th className="w-56 pl-2">Early-exit rate</th>
                </tr>
              </thead>
              <tbody>
                {[...d.monthlyBySource].sort((a, b) => (b.earlyExitRatePct ?? -1) - (a.earlyExitRatePct ?? -1)).map(s => (
                  <tr key={s.source} {...drillable(() => drill({ population: "joiners", source: s.source, sort: "date", title: `Joiners from ${s.source} - ${num(s.joiners)}` }), `Open ${s.joiners} joiners from ${s.source}`)} className={`border-b border-slate-50 last:border-0 hover:bg-slate-50 ${DRILL_FOCUS}`}>
                    <td className="max-w-[200px] truncate py-2 pr-2 font-semibold text-slate-800">{s.source}</td>
                    <td className="px-2 text-right tabular-nums text-slate-600">{num(s.joiners)}</td>
                    <td className="px-2 text-right tabular-nums text-slate-600">{num(s.exits)}</td>
                    <td className="pl-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={s.earlyExitRatePct === null ? "No rate" : `Early exit rate ${s.earlyExitRatePct.toFixed(1)} percent`}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, s.earlyExitRatePct ?? 0)}%`, background: (s.earlyExitRatePct ?? 0) >= 40 ? STATUS.critical : (s.earlyExitRatePct ?? 0) >= 25 ? SERIES[1] : SERIES[0] }} />
                        </div>
                        <span className="w-12 text-right text-xs font-bold tabular-nums">{s.earlyExitRatePct === null ? "n/a" : pct(s.earlyExitRatePct, 0)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}

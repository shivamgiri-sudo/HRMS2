/** Insights-tab sections added in round 2: batch heatmap, hiring scorecard, 30-day outlook, reason capture. */
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_TICK, ChartCard, EmptyState, GRID_PROPS, SERIES, STATUS, TOOLTIP_STYLE, num, pct } from "@/components/analytics/analytics-kit";
import { type ScorecardBy, useHubBatches, useHubInsights, useHubOutlook, useHubScorecard } from "./api";
import { ChartKeyNav, DRILL_FOCUS, ErrorCard, Segmented, Shimmer, drillable, heatColor } from "./charts";
import { useDrill } from "./DrillContext";
import type { DrillQuery, HubBatch, OutlookRow } from "./types";

const SURV: { k: keyof HubBatch["survival"]; l: string }[] = [
  { k: "d1", l: "D1" }, { k: "d3", l: "D3" }, { k: "d7", l: "D7" }, { k: "d15", l: "D15" }, { k: "d30", l: "D30" }, { k: "d60", l: "D60" }, { k: "d90", l: "D90" },
];
const SHOW: { k: keyof HubBatch["showUp"]; l: string }[] = [{ k: "d1", l: "D1" }, { k: "d3", l: "D3" }, { k: "d7", l: "D7" }];
const weekLabel = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }); };

function Cell2({ v }: { v: number | null }) {
  const c = heatColor(v);
  return (
    <td className="p-0.5 text-center">
      <div className="mx-auto flex h-8 min-w-[40px] items-center justify-center rounded-md text-[11px] font-bold tabular-nums"
        style={v === null ? { backgroundImage: "repeating-linear-gradient(45deg,#f1f5f9 0 4px,#e2e8f0 4px 5px)", color: "#94a3b8" } : { background: c.bg, color: c.fg }}
        aria-label={v === null ? "not available yet" : `${Math.round(v)} percent`}>
        {v === null ? "-" : Math.round(v)}
      </div>
    </td>
  );
}

export function BatchHeatmap() {
  const q = useHubBatches();
  const drill = useDrill();
  const batches = q.data?.batches ?? [];
  const maxJoined = Math.max(1, ...batches.map(b => b.joined));
  const open = (b: HubBatch) => drill({ population: "joiners", joinWeek: b.weekStart, sort: "date", title: `Batch of ${weekLabel(b.weekStart)} - ${num(b.joined)} joiners` });
  const th = "px-1 pb-1 text-center text-[10px] font-bold uppercase tracking-wider text-slate-500";
  return (
    <ChartCard
      title="New-joiner batches"
      subtitle="One row per joining week. Survival = % of the batch still employed N days after joining; show-up = % who were present within N days. Click a row to see the batch."
      footer={
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span>Low</span>
          <span aria-hidden className="h-2.5 w-40 rounded-full" style={{ background: "linear-gradient(90deg,rgb(248,113,113),rgb(252,211,77),rgb(52,211,153))" }} />
          <span>High (40% or below is fully red)</span>
          <span className="ml-3 inline-flex items-center gap-1.5"><span aria-hidden className="h-3 w-5 rounded" style={{ backgroundImage: "repeating-linear-gradient(45deg,#f1f5f9 0 4px,#e2e8f0 4px 5px)" }} /> not old enough yet</span>
        </div>
      }
    >
      {q.isLoading ? <Shimmer className="h-72" /> : q.error ? <ErrorCard what="the batch survival" error={q.error} onRetry={() => q.refetch()} /> : batches.length === 0 ? <EmptyState label="No joining batches yet" height={160} /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <caption className="sr-only">Survival and show-up by joining week</caption>
            <thead>
              <tr>
                <th rowSpan={2} className="sticky left-0 z-10 bg-white px-2 pb-1 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">Week of</th>
                <th rowSpan={2} className={th}>Joined</th>
                <th rowSpan={2} className={th}>Active now</th>
                <th colSpan={SURV.length} className="border-b border-slate-100 pb-1 text-center text-[10px] font-bold uppercase tracking-wider text-slate-600">Still employed after</th>
                <th colSpan={SHOW.length} className="border-b border-slate-100 pb-1 text-center text-[10px] font-bold uppercase tracking-wider text-slate-600">Showed up within</th>
              </tr>
              <tr>{SURV.map(s => <th key={`s${s.k}`} className={th}>{s.l}</th>)}{SHOW.map(s => <th key={`u${s.k}`} className={th}>{s.l}</th>)}</tr>
            </thead>
            <tbody>
              {batches.map(b => (
                <tr key={b.weekStart} {...drillable(() => open(b), `Open the batch that joined the week of ${weekLabel(b.weekStart)}, ${b.joined} people`)} className={`group border-t border-slate-50 hover:bg-slate-50 ${DRILL_FOCUS}`}>
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-0.5 text-xs font-semibold text-slate-800 group-hover:bg-slate-50">{weekLabel(b.weekStart)}</td>
                  <td className="px-2 py-0.5">
                    <div className="flex items-center gap-1.5"><span className="w-7 text-right text-xs font-bold tabular-nums text-slate-900">{b.joined}</span><span aria-hidden className="h-1.5 rounded-full bg-slate-300" style={{ width: `${Math.max(4, (b.joined / maxJoined) * 36)}px` }} /></div>
                  </td>
                  <td className="px-2 py-0.5 text-center text-xs tabular-nums text-slate-700">{b.activeNow}{b.absentNow > 0 && <span className="ml-1 rounded bg-rose-50 px-1 text-[10px] font-bold text-rose-700" title="Absent 3+ days among those still active">{b.absentNow} absent</span>}</td>
                  {SURV.map(s => <Cell2 key={`s${s.k}`} v={b.survival[s.k]} />)}
                  {SHOW.map(s => <Cell2 key={`u${s.k}`} v={b.showUp[s.k]} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}

const BY: { value: ScorecardBy; label: string }[] = [{ value: "source", label: "Source" }, { value: "branch", label: "Branch" }, { value: "process", label: "Process" }, { value: "designation", label: "Designation" }];
const BY_KEY = { branch: "branchId", process: "processId", designation: "designationId" } as const;
const WIN: { k: "s30" | "s60" | "s90"; l: string; c: string }[] = [{ k: "s30", l: "30d", c: SERIES[0] }, { k: "s60", l: "60d", c: SERIES[6] }, { k: "s90", l: "90d", c: SERIES[2] }];

export function ScorecardCard() {
  const [by, setBy] = useState<ScorecardBy>("source");
  const q = useHubScorecard(by);
  const drill = useDrill();
  const d = q.data;
  const open = (r: { id: string | null; label: string; joined: number }) => {
    if (by !== "source" && !r.id) return;
    const dim = by === "source" ? { source: r.label } : { [BY_KEY[by]]: r.id };
    drill({ population: "joiners", sort: "date", ...dim, title: `Joiners via ${r.label} - ${num(r.joined)}` } as DrillQuery);
  };
  return (
    <ChartCard
      title="Hiring quality scorecard"
      subtitle="Of people who joined in the last 12 months, the % still employed 30, 60 and 90 days later. The black tick on each bar is the company value. Rows with fewer than 10 joiners are muted."
      action={<Segmented<ScorecardBy> label="Scorecard by" value={by} onChange={setBy} options={BY} />}
      footer={<div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600">{WIN.map(w => <span key={w.k} className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: w.c }} />Still here at {w.l}{d?.company[w.k] != null && <span className="tabular-nums text-slate-400">(company {pct(d.company[w.k] as number, 0)})</span>}</span>)}</div>}
    >
      {!d ? (q.error ? <ErrorCard what="the hiring scorecard" error={q.error} onRetry={() => q.refetch()} /> : <Shimmer className="h-64" />) : d.rows.length === 0 ? <EmptyState label="No joiners in the last 12 months" height={140} /> : (
        <ul className="space-y-1.5" aria-label={`Hiring quality by ${by}`}>
          {d.rows.map(r => {
            const low = r.joined < 10;
            const clickable = by === "source" || !!r.id;
            return (
              <li key={r.id ?? r.label} {...(clickable ? drillable(() => open(r), `Open ${r.joined} joiners from ${r.label}`) : {})}
                className={`grid grid-cols-[minmax(110px,170px)_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-1.5 sm:grid-cols-[200px_minmax(0,1fr)] ${clickable ? `hover:bg-slate-50 ${DRILL_FOCUS}` : ""} ${low ? "opacity-55" : ""}`}>
                <div className="min-w-0"><div className="truncate text-xs font-semibold text-slate-800" title={r.label}>{r.label}</div><div className="text-[11px] tabular-nums text-slate-500">n={num(r.joined)}{low ? " · low sample" : ""}</div></div>
                <div className="space-y-1">
                  {WIN.map(w => {
                    const v = r[w.k]; const comp = d.company[w.k];
                    return (
                      <div key={w.k} className="flex items-center gap-2">
                        <div className="relative h-2.5 flex-1 rounded-full bg-slate-100" role="img" aria-label={`${w.l}: ${v === null ? "not enough tenure yet" : pct(v, 0)}${comp !== null ? `, company ${pct(comp, 0)}` : ""}`}>
                          {v !== null && <div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${v}%`, background: w.c }} />}
                          {comp !== null && <div aria-hidden className="absolute -top-0.5 h-3.5 w-0.5 rounded bg-slate-800" style={{ left: `${comp}%` }} />}
                        </div>
                        <span className="w-14 text-right text-[11px] tabular-nums text-slate-700"><strong>{v === null ? "-" : pct(v, 0)}</strong></span>
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ChartCard>
  );
}

export function OutlookCard() {
  const q = useHubOutlook();
  const drill = useDrill();
  const [dim, setDim] = useState<"branch" | "process">("branch");
  const d = q.data;
  const steps = useMemo(() => {
    if (!d) return [];
    const a = d.headcount - d.expectedExits;
    const b = a - d.noticeExits;
    const lo0 = Math.max(0, Math.floor(Math.min(d.projected, b) * 0.9));
    return [
      { name: "Headcount now", range: [lo0, d.headcount], v: d.headcount, raw: d.headcount, fill: "#64748b" },
      { name: "Expected exits", range: [a, d.headcount], v: d.expectedExits, raw: -d.expectedExits, fill: STATUS.critical },
      { name: "Serving notice", range: [b, a], v: d.noticeExits, raw: -d.noticeExits, fill: STATUS.serious },
      { name: "Planned joiners", range: [b, b + d.plannedJoiners], v: d.plannedJoiners, raw: d.plannedJoiners, fill: SERIES[2] },
      { name: "Projected in 30d", range: [lo0, d.projected], v: d.projected, raw: d.projected, fill: SERIES[0] },
    ];
  }, [d]);
  const lo = d ? Math.max(0, Math.floor(Math.min(d.projected, d.headcount - d.expectedExits - d.noticeExits) * 0.9)) : 0;
  const hi = d ? Math.ceil(Math.max(d.headcount, d.projected, d.headcount - d.expectedExits - d.noticeExits + d.plannedJoiners) * 1.03) : 0;
  const rows: OutlookRow[] = d ? (dim === "branch" ? d.byBranch : d.byProcess) : [];
  const maxGap = Math.max(1, ...rows.map(r => Math.abs(r.gapPct ?? 0)));
  const openRow = (r: OutlookRow) => {
    if (!r.id) return;
    drill({ population: "active", sort: "score", [dim === "branch" ? "branchId" : "processId"]: r.id, title: `${r.label} - ${num(r.headcount)} people today, ${r.projected} projected` } as DrillQuery);
  };
  return (
    <ChartCard title="Next 30 days outlook" subtitle="Where headcount lands in 30 days: today's headcount, minus people expected to leave, minus those already serving notice, plus planned joiners.">
      {!d ? (q.error ? <ErrorCard what="the outlook" error={q.error} onRetry={() => q.refetch()} /> : <Shimmer className="h-72" />) : (
        <div className="space-y-5">
          <div role="img" aria-label={`Outlook: headcount ${d.headcount}, expected exits ${d.expectedExits}, notice exits ${d.noticeExits}, planned joiners ${d.plannedJoiners}, projected ${d.projected}`}>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={steps} margin={{ top: 22, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
                <YAxis domain={[lo, hi]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#f1f5f9" }} formatter={(_v: unknown, _k: string, p: { payload?: { raw: number } }) => [`${(p.payload?.raw ?? 0) > 0 && p.payload?.raw !== d.headcount && p.payload?.raw !== d.projected ? "+" : ""}${num(Math.round((p.payload?.raw ?? 0) * 10) / 10)}`, "People"]} />
                <Bar dataKey="range" radius={[8, 8, 0, 0]} isAnimationActive={false}>
                  {steps.map(s => <Cell key={s.name} fill={s.fill} />)}
                  <LabelList dataKey="raw" position="top" fontSize={11} fontWeight={700} fill="#334155" formatter={(v: number) => (v > 0 && v !== d.headcount && v !== d.projected ? `+${num(Math.round(v * 10) / 10)}` : num(Math.round(v * 10) / 10))} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-center text-[11px] text-slate-400">Axis starts at {num(lo)} so the changes are visible.</p>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Biggest projected gaps first</h4>
              <Segmented<"branch" | "process"> label="Outlook by" value={dim} onChange={setDim} options={[{ value: "branch", label: "Branch" }, { value: "process", label: "Process" }]} />
            </div>
            {rows.length === 0 ? <EmptyState label="No groups to show" height={100} /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead><tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-1.5 pr-2 capitalize">{dim}</th><th className="px-2 text-right">Now</th><th className="px-2 text-right">Exp. exits</th><th className="px-2 text-right">Notice</th><th className="px-2 text-right">Joiners</th><th className="px-2 text-right">Projected</th><th className="w-44 pl-2">Gap</th>
                  </tr></thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id ?? r.label} {...(r.id ? drillable(() => openRow(r), `Open people in ${r.label}`) : {})} className={`border-b border-slate-50 last:border-0 ${r.id ? `hover:bg-slate-50 ${DRILL_FOCUS}` : ""}`}>
                        <td className="max-w-[180px] truncate py-2 pr-2 font-semibold text-slate-800">{r.label}</td>
                        <td className="px-2 text-right tabular-nums text-slate-600">{num(r.headcount)}</td>
                        <td className="px-2 text-right tabular-nums text-slate-600">{r.expectedExits.toFixed(1)}</td>
                        <td className="px-2 text-right tabular-nums text-slate-600">{r.noticeExits}</td>
                        <td className="px-2 text-right tabular-nums text-slate-600">{r.plannedJoiners}</td>
                        <td className="px-2 text-right font-bold tabular-nums text-slate-900">{num(r.projected)}</td>
                        <td className="pl-2">
                          <div className="flex items-center gap-2">
                            <div className="relative h-2.5 flex-1 rounded-full bg-slate-100" role="img" aria-label={r.gapPct === null ? "no gap data" : `Headcount change ${r.gapPct.toFixed(1)} percent`}>
                              <div aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-slate-300" />
                              {r.gapPct !== null && <div className="absolute inset-y-0 rounded-full" style={{ background: r.gapPct < 0 ? STATUS.critical : SERIES[2], width: `${(Math.abs(r.gapPct) / maxGap) * 50}%`, [r.gapPct < 0 ? "right" : "left"]: "50%" }} />}
                            </div>
                            <span className={`w-14 text-right text-xs font-bold tabular-nums ${(r.gapPct ?? 0) < 0 ? "text-rose-700" : "text-emerald-700"}`}>{r.gapPct === null ? "n/a" : `${r.gapPct > 0 ? "+" : ""}${r.gapPct.toFixed(1)}%`}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <ChartKeyNav label="Outlook row drill" items={rows.filter(r => r.id).map(r => ({ label: `Open ${r.label}`, onOpen: () => openRow(r) }))} />
          </div>
          {d.notes.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-slate-500">{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </div>
      )}
    </ChartCard>
  );
}

export function ReasonCapture() {
  const q = useHubInsights();
  const drill = useDrill();
  const rows = (q.data?.reasonByBranch ?? []).filter(r => r.exits > 0).slice(0, 12).map(r => ({ ...r, v: r.pct ?? 0 }));
  const open = (r: { id: string | null; label: string; exits: number; recorded: number }) => {
    if (!r.id) return;
    drill({ population: "exits", branchId: r.id, noReason: true, windowDays: 365, sort: "date", title: `${r.label}: exits with no reason - ${num(r.exits - r.recorded)}` });
  };
  if (!q.data || rows.length === 0) return null;
  return (
    <ChartCard title="Exit reason capture by branch" subtitle="Share of the last 12 months' exits that have a recorded reason, worst first. The line is 100%. Click a bar to see who is missing a reason.">
      <div className="[&_.recharts-bar-rectangle]:cursor-pointer" role="img" aria-label={`Reason capture: ${rows.map(r => `${r.label} ${r.pct === null ? "n/a" : Math.round(r.pct)} percent`).join(", ")}`}>
        <ResponsiveContainer width="100%" height={Math.max(150, rows.length * 30)}>
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
            <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} unit="%" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="label" width={130} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#f1f5f9" }} formatter={(_v: number | string, _k: string, p: { payload?: { recorded: number; exits: number } }) => [`${p.payload?.recorded} of ${p.payload?.exits} exits`, "Reason recorded"]} />
            <ReferenceLine x={100} stroke="#0f172a" strokeDasharray="4 3" />
            <Bar dataKey="v" radius={[0, 8, 8, 0]} isAnimationActive={false} onClick={(x: { payload?: (typeof rows)[number] }) => x.payload && open(x.payload)}>
              {rows.map(r => <Cell key={r.label} fill={r.v >= 80 ? SERIES[2] : r.v >= 40 ? SERIES[3] : STATUS.critical} />)}
              <LabelList dataKey="v" position="right" fontSize={11} fill="#334155" formatter={(v: number) => `${Math.round(v)}%`} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <ChartKeyNav label="Branch drill" items={rows.filter(r => r.id).map(r => ({ label: `Open ${r.label}`, onOpen: () => open(r) }))} />
      </div>
    </ChartCard>
  );
}

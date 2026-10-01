import { useCallback, useMemo, useState } from "react";
import { Filter, Target, Wallet } from "lucide-react";
import { ChartCard, EmptyState, num, pct } from "@/components/analytics/analytics-kit";
import { type PredictionFilters, useHubOverview } from "./api";
import { DRILL_FOCUS, LIFT, Segmented, TIER_COLOR, TIER_LABEL, drillable } from "./charts";
import { useDrill } from "./DrillContext";
import { DriversCard, ModelSection } from "./ModelCards";
import RiskBoard from "./RiskBoard";
import RiskDrawer from "./RiskDrawer";
import { TIERS, type HubRisk, type RiskGroup, type Tier } from "./types";

type Dim = "manager" | "process" | "branch";
const DIM_KEY = { manager: "managerId", process: "processId", branch: "branchId" } as const;

function TierOverview({ risk, filters, setFilters }: { risk?: HubRisk; filters: PredictionFilters; setFilters: (f: PredictionFilters) => void }) {
  const overview = useHubOverview();
  const drill = useDrill();
  const counts = risk?.tierCounts;
  const total = counts ? TIERS.reduce((s, t) => s + (counts[t] ?? 0), 0) : 0;
  const expected = overview.data?.expectedExits30;
  const pick = (t: Tier) => drill({ population: "active", tier: t, sort: "score", title: `${TIER_LABEL[t]} risk - ${num(counts?.[t] ?? 0)} people` });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
      <ChartCard className="lg:col-span-2" title="Risk tiers" subtitle="Share of people in each risk tier for the current filters. Select a tier or a bar segment to see who is in it.">
        {!counts ? <div className="h-20 animate-pulse rounded-lg bg-slate-100" /> : total === 0 ? <EmptyState label="Nobody in scope" height={80} /> : (
          <div className="space-y-4">
            <div role="img" aria-label={`Tier distribution: ${TIERS.map(t => `${TIER_LABEL[t]} ${counts[t] ?? 0}`).join(", ")}`} className="flex h-5 w-full overflow-hidden rounded-full bg-slate-100">
              {TIERS.map(t => (counts[t] ?? 0) > 0 && (
                <div key={t} style={{ width: `${((counts[t] ?? 0) / total) * 100}%`, background: TIER_COLOR[t] }} {...drillable(() => pick(t), `Open ${counts[t] ?? 0} people at ${t.toLowerCase()} risk`)} className={`h-full border-r border-white last:border-r-0 motion-safe:transition-[width] motion-safe:duration-500 hover:brightness-110 ${DRILL_FOCUS}`} title={`${TIER_LABEL[t]}: ${counts[t]} (${pct(((counts[t] ?? 0) / total) * 100)})`} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TIERS.map(t => {
                return (
                  <button key={t} type="button" onClick={() => pick(t)} aria-label={`Open ${counts[t] ?? 0} people at ${t.toLowerCase()} risk`}
                    className={`rounded-lg border border-slate-200 bg-white p-2.5 text-left hover:bg-slate-50 ${DRILL_FOCUS} ${LIFT}`}>
                    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: TIER_COLOR[t] }} />{TIER_LABEL[t]}</div>
                    <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{num(counts[t] ?? 0)}</div>
                    <div className="text-[11px] tabular-nums text-slate-500">{pct(((counts[t] ?? 0) / total) * 100)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </ChartCard>
      <ChartCard title="Expected exits, next 30 days" subtitle="Sum of each person's calibrated 30-day probability, company-wide.">
        <div {...drillable(() => drill({ population: "active", sort: "score", title: `Most likely to leave in 30 days - ~${num(Math.round(expected ?? 0))} expected` }), "Open the people most likely to leave in the next 30 days")} className={`flex h-full flex-col items-center justify-center gap-1 rounded-lg py-2 text-center hover:bg-slate-50 ${DRILL_FOCUS}`}>
          <Target className="h-5 w-5 text-slate-300" aria-hidden />
          <div className="text-5xl font-bold tabular-nums text-slate-900">{expected === undefined ? "—" : `~${num(Math.round(expected))}`}</div>
          <p className="max-w-[220px] text-[11px] text-slate-500">people likely to leave. An estimate for planning, not a list of names.</p>
        </div>
      </ChartCard>
    </div>
  );
}

function Hotspots({ risk, filters, setFilters }: { risk?: HubRisk; filters: PredictionFilters; setFilters: (f: PredictionFilters) => void }) {
  const [dim, setDim] = useState<Dim>("manager");
  const rows: RiskGroup[] = risk?.groups[dim] ?? [];
  const max = Math.max(1, ...rows.map(r => r.avgScore));
  const key = DIM_KEY[dim];
  const drill = useDrill();
  const open = (g: RiskGroup) => drill({ population: "active", sort: "score", [key]: g.id, title: `${g.label} - ${num(g.headcount)} people, ${g.highRisk} high or critical` });
  return (
    <ChartCard
      title="Where risk is concentrated"
      subtitle="Average risk score, High + Critical count and expected 30-day exits per group. Select a row to see its people, or the filter icon to narrow the board."
      action={<Segmented<Dim> label="Group by" value={dim} onChange={setDim} options={[{ value: "manager", label: "Manager" }, { value: "process", label: "Process" }, { value: "branch", label: "Branch" }]} />}
    >
      {!risk ? <div className="h-40 animate-pulse rounded-lg bg-slate-100" /> : rows.length === 0 ? <EmptyState label="No groups to show" height={120} /> : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <th className="py-1.5 pr-2 capitalize">{dim}</th><th className="px-2">Avg score</th><th className="px-2 text-right">High+Crit</th><th className="px-2 text-right">Exp. exits</th><th className="px-2 text-right">People</th><th className="pl-2" aria-label="Filter board" />
              </tr>
            </thead>
            <tbody>
              {rows.map(g => {
                const on = !!g.id && filters[key] === g.id;
                return (
                  <tr key={g.id ?? g.label} tabIndex={g.id ? 0 : -1} role={g.id ? "button" : undefined}
                    aria-label={g.id ? `Open people in ${dim} ${g.label}` : undefined}
                    onClick={() => g.id && open(g)}
                    onKeyDown={e => { if (g.id && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(g); } }}
                    className={`border-b border-slate-50 last:border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400 ${g.id ? "cursor-pointer hover:bg-slate-50" : ""} ${on ? "bg-slate-100" : ""}`}>
                    <td className="max-w-[200px] truncate py-2 pr-2 font-semibold text-slate-800">{g.label}</td>
                    <td className="w-40 px-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1"><MiniBarInline v={g.avgScore} max={max} /></div>
                        <span className="w-8 text-right text-xs font-bold tabular-nums text-slate-800">{g.avgScore.toFixed(0)}</span>
                      </div>
                    </td>
                    <td className="px-2 text-right tabular-nums">{g.highRisk > 0 ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">{g.highRisk}</span> : <span className="text-slate-400">0</span>}</td>
                    <td className="px-2 text-right tabular-nums text-slate-700">{g.expectedExits30.toFixed(1)}</td>
                    <td className="px-2 text-right tabular-nums text-slate-500">{num(g.headcount)}</td>
                    <td className="pl-2 text-right">{g.id && <button type="button" aria-pressed={on} aria-label={`Filter risk board by ${dim} ${g.label}`} title="Filter the risk board" onClick={e => { e.stopPropagation(); setFilters({ ...filters, [key]: on ? undefined : g.id, offset: 0 }); }} className={`rounded-md p-1 ${on ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"} ${DRILL_FOCUS}`}><Filter className="h-3.5 w-3.5" aria-hidden /></button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}

function MiniBarInline({ v, max }: { v: number; max: number }) {
  const color = v >= 60 ? TIER_COLOR.CRITICAL : v >= 45 ? TIER_COLOR.HIGH : v >= 30 ? TIER_COLOR.MEDIUM : TIER_COLOR.LOW;
  return <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: color }} /></div>;
}

export default function PredictionTab({ filters, setFilters }: { filters: PredictionFilters; setFilters: (f: PredictionFilters) => void }) {
  const [risk, setRisk] = useState<HubRisk | undefined>();
  const [openId, setOpenId] = useState<string | null>(null);
  const onData = useCallback((d: HubRisk | undefined) => setRisk(d), []);
  const drivers = useMemo(() => risk?.drivers ?? [], [risk]);
  const drill = useDrill();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => drill({ population: "active", group: "compensation", sort: "score", title: "Pay & growth worklist - people with pay or growth signals" })}
          className={`inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 ${DRILL_FOCUS} ${LIFT}`}>
          <Wallet className="h-3.5 w-3.5" aria-hidden /> Pay &amp; growth worklist
        </button>
        <span className="text-[11px] text-slate-500">People whose score is pushed up by pay gaps or stalled growth.</span>
      </div>
      <TierOverview risk={risk} filters={filters} setFilters={setFilters} />
      <ModelSection />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <DriversCard drivers={drivers} model={null} />
        <Hotspots risk={risk} filters={filters} setFilters={setFilters} />
      </div>
      <RiskBoard filters={filters} setFilters={setFilters} onOpen={r => setOpenId(r.employeeId)} onData={onData} />
      <RiskDrawer employeeId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

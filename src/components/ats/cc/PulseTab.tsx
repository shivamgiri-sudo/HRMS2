import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, CalendarClock, Filter, Gauge as GaugeIcon, GitBranch, Grid3x3, Hourglass, Layers3, Lightbulb, Network, Target, TrendingUp, UserCheck, UserPlus, UserX, Users, Workflow } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAtsOverview, type AtsOverview } from "@/hooks/useAtsOverview";
import { useCohorts, useStageDwell } from "@/hooks/useAtsCommandCenter";
import { useDrillActions } from "@/components/ats/overview/drill";
import { Empty, Gauge, V, fmt, tooltipStyle } from "@/components/ats/overview/viz";
import { FlowViz, FunnelViz, Heatmap, SourceTreemap, TrendViz } from "@/components/ats/overview/charts";
import { DemandSupplyCard } from "./DemandSupplyCard";
import { humanizeStage } from "./stage-label";
import { Card, ExportButton, FilterBar, HeatTable, InsightList, KpiCard, Section, downloadCsv, type InsightItem } from "./cc-kit";
import { useCC } from "./cc-context";

const tick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const DAY = ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Auto findings for the headline view. Same thresholds as the Insights tab so numbers and wording agree. */
function findings(d: AtsOverview, go: (crumb: string, extra?: Record<string, unknown>, noPeriod?: boolean) => void): InsightItem[] {
  const out: InsightItem[] = [];
  const { kpis, queue } = d;
  if (queue.slaBreach > 0) out.push({ tone: "bad", title: `${queue.slaBreach} waiting past the ${queue.slaMinutes}-minute SLA`, body: `Average wait ${queue.avgWaitMin} min right now.`, onClick: () => go("Waiting today", { outcome: "waiting", from: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) }, true) });
  const stale = d.aging.find((a) => a.bucket === "15d+")?.n || 0;
  if (stale > 0) out.push({ tone: "warn", title: `${fmt(stale)} open candidates idle for 15+ days`, body: "Re-engage or close them.", onClick: () => go("Idle 15d+", { idle: "15d+" }, true) });
  if (d.dropoff[0]) out.push({ tone: "info", title: `Most rejections follow "${d.dropoff[0].stage}"`, body: `${fmt(d.dropoff[0].n)} candidates.`, onClick: () => go(`Rejected after ${d.dropoff[0].stage}`, { stage: d.dropoff[0].stage, outcome: "rejected" }) });
  const best = [...d.sources].filter((s) => s.total >= 10).sort((a, b) => b.convRate - a.convRate)[0];
  if (best) out.push({ tone: "good", title: `${best.name} is the best source at ${best.convRate}%`, body: `${fmt(best.total)} candidates.`, onClick: () => go(`Source: ${best.name}`, { source: best.name }) });
  if (kpis.noShowRate > 15) out.push({ tone: "warn", title: `${kpis.noShowRate}% of engaged candidates were no-shows`, body: `${fmt(kpis.noShow)} candidates.`, onClick: () => go("No-shows", { outcome: "noShow" }) });
  if (kpis.offersTotal > 0 && kpis.offerApprovalRate < 90) out.push({ tone: "warn", title: `Only ${kpis.offerApprovalRate}% of offers cleared approval` });
  if (kpis.bgvFlagRate > 20) out.push({ tone: "warn", title: `${kpis.bgvFlagRate}% of background checks need referral or were negative` });
  if (kpis.walkoutRate > 15) out.push({ tone: "warn", title: `${kpis.walkoutRate}% of today's walk-ins left before their interview` });
  return out.slice(0, 7);
}

export function PulseTab() {
  const cc = useCC();
  const drill = useDrillActions();
  const { data: d, isLoading } = useAtsOverview(cc.period, cc.branch);
  const base = cc.drill();
  const go = (crumb: string, extra: Record<string, unknown> = {}, noPeriod = false) =>
    drill.openDrill(crumb, noPeriod ? { branch: cc.branch || undefined, ...extra } : { ...base, ...extra });
  const dwell = useStageDwell(base);
  const cohorts = useCohorts(12, { branch: cc.branch || undefined });

  const branchNames = useMemo(() => (d?.branches ?? []).map((b) => b.name).filter((n) => n !== "Unspecified" && n !== "Unmapped"), [d]);
  const spark = (k: "registered" | "selected" | "rejected") => (d?.trend ?? []).map((t) => ({ v: t[k] }));

  if (isLoading || !d) {
    return <div className="space-y-4"><Skeleton className="h-14 rounded-2xl" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div><Skeleton className="h-80 rounded-2xl" /></div>;
  }
  const k = d.kpis;
  const insights = findings(d, go);
  const projGap = d.runRate.projectedSelected;

  return (
    <div className="space-y-5">
      <FilterBar show={["period", "branch"]} branches={branchNames}
        right={<ExportButton onClick={() => downloadCsv("ats-pulse-branches.csv", ["Branch", "Candidates", "Selected", "Rejected", "Selection %"], d.branches.map((b) => [b.name, b.total, b.selected, b.rejected, b.selRate]))} label="Export branches" />} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard i={0} label="Registered" value={k.registered.value} delta={k.registered.delta} icon={<UserPlus className="h-4 w-4" />} color={V.blue} spark={spark("registered")} onClick={() => go("Registered")} />
        <KpiCard i={1} label="Selected" value={k.selected.value} delta={k.selected.delta} sub={`${k.selected.rate ?? 0}% of registered`} icon={<UserCheck className="h-4 w-4" />} color={V.aqua} spark={spark("selected")} onClick={() => go("Selected", { outcome: "selected" })} />
        <KpiCard i={2} label="Rejected" value={k.rejected.value} delta={k.rejected.delta} deltaInvert sub={`${k.rejected.rate ?? 0}% of registered`} icon={<UserX className="h-4 w-4" />} color={V.orange} spark={spark("rejected")} onClick={() => go("Rejected", { outcome: "rejected" })} />
        <KpiCard i={3} label="Joined" value={k.joined.value} delta={k.joined.delta} sub={`${k.joined.rate ?? 0}% of selected`} icon={<Users className="h-4 w-4" />} color={V.violet} onClick={() => go("Joined", { outcome: "joined" })} />
        <KpiCard i={4} label="In process" value={k.inProcess.value} sub="open right now" icon={<Hourglass className="h-4 w-4" />} color={V.yellow} onClick={() => go("In process", { outcome: "waiting" }, true)} />
        <KpiCard i={5} label="No-show rate" value={k.noShowRate} decimals={k.noShowRate % 1 ? 1 : 0} suffix="%" deltaInvert sub={`${fmt(k.noShow)} candidates`} icon={<AlertTriangle className="h-4 w-4" />} color={V.red} onClick={() => go("No-shows", { outcome: "noShow" })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7" i={1} title="Hiring health" hint="Five rates that say whether the pipeline is working" icon={<GaugeIcon className="h-4 w-4" />}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <Gauge value={k.selected.rate ?? 0} color={V.aqua} label="Selection rate" sub="of registered" />
            <Gauge value={100 - k.noShowRate} color={V.blue} label="Show-up rate" sub={`${k.noShowRate}% no-show`} />
            <Gauge value={k.offerApprovalRate} color={V.violet} label="Offers approved" sub={`${fmt(k.offersTotal)} offers`} />
            <Gauge value={100 - k.bgvFlagRate} color={V.yellow} label="BGV not flagged" sub={`${k.bgvFlagRate}% flagged`} />
            <Gauge value={d.queue.today ? Math.round(((d.queue.today - d.queue.slaBreach) / d.queue.today) * 100) : 100} color={V.orange} label="Queue SLA met" sub={`${d.queue.slaBreach} breaches`} />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
            <span>Time to select <b className="text-foreground">{k.hrsToSelect} h</b></span>
            <span>Average queue wait <b className="text-foreground">{d.queue.avgWaitMin} min</b></span>
            <span>Walk-out rate <b className="text-foreground">{k.walkoutRate}%</b></span>
            <span>Unresolved duplicates <b className="text-foreground">{k.duplicateUnresolved}</b></span>
          </div>
        </Card>
        <Card className="lg:col-span-5" i={2} title="What needs attention" hint="Click a finding to drill" icon={<Lightbulb className="h-4 w-4" />}>
          <InsightList items={insights} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5" i={3} title="Hiring funnel" hint="Applied to joined; chips show step conversion" icon={<Filter className="h-4 w-4" />}>
          <FunnelViz data={d.funnel[0]?.n === d.funnel[1]?.n ? d.funnel.slice(1) : d.funnel}
            onSelect={(stage) => go(stage, stage === "Selected" ? { outcome: "selected" } : stage === "Joined" ? { outcome: "joined" } : stage === "Offer approved" ? { outcome: "offered" } : { stage })} />
        </Card>
        <Card className="lg:col-span-7" i={4} title="Daily trend" hint="Outcomes per day with a 7-day average" icon={<TrendingUp className="h-4 w-4" />}><TrendViz data={d.trend} /></Card>
      </div>

      <Section title="Where it is strong and where it is not" hint="Every cell and name drills one level down">
        <div className="grid gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-7" i={5} title="Branch scorecard" hint="Each column is shaded on its own scale" icon={<GitBranch className="h-4 w-4" />}>
            <HeatTable rows={d.branches} max={16}
              cols={[
                { key: "t", label: "Candidates", get: (r) => r.total },
                { key: "s", label: "Selected %", get: (r) => r.selRate, format: (n) => `${n}%`, hue: "green" },
                { key: "r", label: "Rejected %", get: (r) => (r.total ? Math.round((r.rejected / r.total) * 100) : 0), format: (n) => `${n}%`, invert: true, hue: "red" },
              ]}
              onRow={(r) => go(r.name, { branch: r.name })} onCell={(r) => go(r.name, { branch: r.name })} />
          </Card>
          <Card className="lg:col-span-5" i={6} title="Movers" hint="Branches that changed most against the previous period" icon={<Activity className="h-4 w-4" />}>
            <ul className="space-y-1.5">
              {[...d.movers.up.slice(0, 3).map((m) => ({ m, up: true })), ...d.movers.down.slice(0, 3).map((m) => ({ m, up: false }))].map(({ m, up }) => (
                <li key={m.name + up}>
                  <button onClick={() => go(m.name, { branch: m.name })} className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                    <span className="truncate text-sm font-medium">{m.name}</span>
                    <span className={`cc-num shrink-0 text-xs font-semibold ${up ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}`}>{m.volumeDelta != null ? `${m.volumeDelta > 0 ? "+" : ""}${m.volumeDelta}% volume` : "new"} · {m.selRate}% sel</span>
                  </button>
                </li>
              ))}
              {!d.movers.up.length && !d.movers.down.length && <Empty text="No comparable previous period" />}
            </ul>
          </Card>
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5" i={7} title="Month projection" hint={`Run-rate for ${d.runRate.month}`} icon={<Target className="h-4 w-4" />}>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-xs text-muted-foreground">Registered so far</div><div className="cc-num text-2xl font-semibold">{fmt(d.runRate.mtdRegistered)}</div></div>
            <div><div className="text-xs text-muted-foreground">Projected month-end</div><div className="cc-num text-2xl font-semibold">{fmt(d.runRate.projectedRegistered)}</div></div>
            <div><div className="text-xs text-muted-foreground">Selected so far</div><div className="cc-num text-2xl font-semibold">{fmt(d.runRate.mtdSelected)}</div></div>
            <div><div className="text-xs text-muted-foreground">Projected selections</div><div className="cc-num text-2xl font-semibold">{fmt(projGap)}</div></div>
          </div>
          <div className="mt-3"><div className="mb-1 flex justify-between text-[11px] text-muted-foreground"><span>Day {d.runRate.dayOfMonth} of {d.runRate.daysInMonth}</span><span>7-day average {d.runRate.dailyAvg7} a day</span></div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--v-track)" }}><div className="h-full rounded-full" style={{ width: `${Math.round((d.runRate.dayOfMonth / d.runRate.daysInMonth) * 100)}%`, background: "linear-gradient(90deg,var(--v-blue),var(--v-violet))" }} /></div></div>
        </Card>
        <Card className="lg:col-span-7" i={8} title="Where candidates wait" hint="Median and 90th-percentile hours in each stage; red marks the bottleneck" icon={<CalendarClock className="h-4 w-4" />}>
          {dwell.isLoading ? <Skeleton className="h-52" /> : dwell.data?.stages.length ? (
            <ResponsiveContainer width="100%" height={Math.max(200, dwell.data.stages.slice(0, 8).length * 34)}>
              <BarChart layout="vertical" data={dwell.data.stages.slice(0, 8).map((s) => ({ ...s, label: humanizeStage(s.stage) }))} margin={{ left: 8, right: 14 }}>
                <CartesianGrid stroke={V.grid} strokeDasharray="3 4" horizontal={false} />
                <XAxis type="number" tick={tick} axisLine={false} tickLine={false} unit=" h" /><YAxis type="category" dataKey="label" width={150} tick={tick} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} formatter={(v: number, n: string) => [`${v} h`, n]} />
                <Bar dataKey="medianHours" name="Median" radius={[0, 6, 6, 0]} className="cursor-pointer" onClick={(p: { stage?: string }) => p.stage && go(`In ${p.stage}`, { stage: p.stage })}>
                  {dwell.data.stages.slice(0, 8).map((s) => <Cell key={s.stage} fill={s.stage === dwell.data!.bottleneck ? V.red : V.blue} />)}
                </Bar>
                <Bar dataKey="p90Hours" name="90th percentile" fill={V.violet} fillOpacity={0.35} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty text="No stage history in this window" />}
        </Card>
      </div>

      <DemandSupplyCard i={9} />

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5" i={9} title="Candidate flow" hint="Where each registration ends up" icon={<Workflow className="h-4 w-4" />}>
          <FlowViz d={d} onSelect={(node) => go(node, { Selected: { outcome: "selected" }, Rejected: { outcome: "rejected" }, "No-show": { outcome: "noShow" }, Joined: { outcome: "joined" } }[node] ?? {})} />
        </Card>
        <Card className="lg:col-span-4" i={10} title="Source quality" hint="Area is volume, colour is selection rate" icon={<Layers3 className="h-4 w-4" />}>
          <SourceTreemap data={d.sources} onSelect={(name) => go(`Source: ${name}`, { source: name })} />
        </Card>
        <Card className="lg:col-span-3" i={11} title="Arrival heat" hint="Day by hour" icon={<Grid3x3 className="h-4 w-4" />}>
          <Heatmap data={d.heatmap} onSelect={(dow, hour) => go(`${DAY[dow]} ${hour}:00`, { dow, hour })} />
        </Card>
      </div>

      <Card i={12} title="Weekly cohorts" hint="Everyone who registered in a week, and where they stand now" icon={<Network className="h-4 w-4" />}
        right={cohorts.data && <ExportButton onClick={() => downloadCsv("ats-cohorts.csv", ["Week", "Registered", "Selected %", "Rejected %", "No-show %", "Joined %", "Median days to decision"], cohorts.data!.cohorts.map((c) => [c.week, c.total, c.selRate, c.rejRate, c.noShowRate, c.joinRate, c.medianDaysToDecision]))} />}>
        {cohorts.isLoading ? <Skeleton className="h-52" /> : cohorts.data?.cohorts.some((c) => c.total) ? (
          <HeatTable rows={cohorts.data.cohorts.filter((c) => c.total).slice().reverse().map((c) => ({ ...c, name: `Week of ${c.week}` }))} max={12}
            cols={[
              { key: "t", label: "Registered", get: (r) => r.total },
              { key: "s", label: "Selected %", get: (r) => r.selRate, format: (n) => `${n}%`, hue: "green" },
              { key: "r", label: "Rejected %", get: (r) => r.rejRate, format: (n) => `${n}%`, invert: true, hue: "red" },
              { key: "n", label: "No-show %", get: (r) => r.noShowRate, format: (n) => `${n}%`, invert: true, hue: "red" },
              { key: "j", label: "Joined %", get: (r) => r.joinRate, format: (n) => `${n}%`, hue: "green" },
              { key: "d", label: "Days to decide", get: (r) => r.medianDaysToDecision ?? 0, format: (n) => (n ? `${n}d` : "–"), invert: true, hue: "blue" },
            ]}
            onRow={(r) => { const end = new Date(`${r.week}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 6); drill.openDrill(r.name, { branch: cc.branch || undefined, from: r.week, to: end.toISOString().slice(0, 10) }); }} />
        ) : <Empty text="No registrations in the last 12 weeks" />}
      </Card>
    </div>
  );
}

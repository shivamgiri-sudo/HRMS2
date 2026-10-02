import { useMemo, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CalendarClock, CalendarDays, Filter, GitBranch, Grid3x3, Hourglass, Layers3, Lightbulb, Network, TrendingUp, UserCheck, UserPlus, UserX, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useDrill, type DrillFilters } from "@/hooks/useAtsDashboards";
import { useCohorts, useLeakage, useStageDwell } from "@/hooks/useAtsCommandCenter";
import { useDrillActions } from "@/components/ats/overview/drill";
import { isoDay } from "@/components/ats/overview/journey";
import { periodFrom } from "@/components/ats/overview/shell";
import { Empty, V, fmt, tooltipStyle } from "@/components/ats/overview/viz";
import { DemandSupplyCard } from "./DemandSupplyCard";
import { humanizeStage } from "./stage-label";
import { Card, ExportButton, FilterBar, HeatTable, InsightList, KpiCard, Section, Waterfall, downloadCsv, heatColor, type InsightItem } from "./cc-kit";
import { useCC } from "./cc-context";
import { funnelFilter, heatGrid, kpiDeltas, pulseFindings, previousWindow, scoreRows, splitNames, weekWindow, type ScoreRow } from "./pulse-scoped-helpers";

const tick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const DAY = ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pctFmt = (n: number) => `${n}%`;

const Loading = ({ h = "h-52" }: { h?: string }) => <Skeleton className={`${h} rounded-xl`} />;
const Failed = ({ what }: { what: string }) => <Empty text={`${what} could not be loaded. The rest of the page is unaffected.`} />;

/** Pulse for branch heads and process managers. Built only on row-scoped endpoints (drill, stage-dwell, cohorts, leakage, benchmark board). */
export function PulseScopedTab() {
  const cc = useCC();
  const drill = useDrillActions();
  const base = cc.drill();
  const go = (crumb: string, extra: DrillFilters = {}) => drill.openDrill(crumb, { ...base, ...extra });

  // Filter options come from a drill that ignores the process and recruiter filters, so the lists never shrink to the current pick.
  const optsFilters: DrillFilters = { ...base, process: undefined, recruiter: undefined };
  const opts = useDrill(optsFilters);
  const cur = useDrill(base);
  const prevWin = useMemo(() => previousWindow(cc.period, isoDay()), [cc.period]);
  const prev = useDrill(prevWin ? { ...base, ...prevWin } : null);
  const leak = useLeakage(base);
  const dwell = useStageDwell(base);
  const cohortFilters: DrillFilters = { branch: cc.branch || undefined, process: cc.process || undefined, recruiter: cc.recruiter || undefined };
  const cohorts = useCohorts(12, cohortFilters);

  const d = cur.data;
  const deltas = kpiDeltas(d, prevWin ? prev.data : null);
  const spark = (k: "total" | "selected" | "rejected") => (d?.trend ?? []).map((t) => ({ v: t[k] }));
  const insights: InsightItem[] = pulseFindings(d).map((f) => ({ tone: f.tone, title: f.title, body: f.body, onClick: f.drill ? () => go(f.drill!.crumb, f.drill!.extra) : undefined }));
  const grid = useMemo(() => heatGrid(d?.hourDow), [d]);
  const procRows = useMemo(() => scoreRows(d?.splits.process), [d]);
  const srcRows = useMemo(() => scoreRows(d?.splits.source), [d]);
  const k = d?.kpis;

  const scoreCols = [
    { key: "t", label: "Candidates", get: (r: ScoreRow) => r.total },
    { key: "s", label: "Selected %", get: (r: ScoreRow) => r.selPct, format: pctFmt, hue: "green" as const },
    { key: "r", label: "Rejected %", get: (r: ScoreRow) => r.rejPct, format: pctFmt, invert: true, hue: "red" as const },
    { key: "n", label: "No-show %", get: (r: ScoreRow) => r.noShowPct, format: pctFmt, invert: true, hue: "red" as const },
    { key: "j", label: "Joined %", get: (r: ScoreRow) => r.joinPct, format: pctFmt, hue: "green" as const },
  ];
  const scorecard = (rows: ScoreRow[], key: "process" | "source", label: string, icon: ReactNode, i: number, span: string) => (
    <Card className={span} i={i} title={`${label} scorecard`} hint="Each column is shaded on its own scale; click to drill" icon={icon}
      right={rows.length > 0 && <ExportButton onClick={() => downloadCsv(`ats-pulse-${key}.csv`, [label, "Candidates", "Selected %", "Rejected %", "No-show %", "Joined %"], rows.map((r) => [r.name, r.total, r.selPct, r.rejPct, r.noShowPct, r.joinPct]))} />}>
      {cur.isLoading ? <Loading /> : cur.isError ? <Failed what="The scorecard" /> : rows.length ? (
        <HeatTable rows={rows} max={14} cols={scoreCols} onRow={(r) => go(r.name, { [key]: r.name })} onCell={(r) => go(r.name, { [key]: r.name })} />
      ) : <Empty text={`No ${label.toLowerCase()} data in this window`} />}
    </Card>
  );

  return (
    <div className="space-y-5">
      <FilterBar show={["period", "process", "recruiter"]} processes={splitNames(opts.data?.splits.process)} recruiters={splitNames(opts.data?.splits.recruiter)} />

      {cur.isError && !d && <Card title="Headline numbers"><Failed what="The headline numbers" /></Card>}
      {(!cur.isError || d) && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {!k ? [0, 1, 2, 3, 4, 5].map((n) => <Skeleton key={n} className="h-36 rounded-2xl" />) : (<>
            <KpiCard i={0} label="Registered" value={k.total} delta={deltas.total} icon={<UserPlus className="h-4 w-4" />} color={V.blue} spark={spark("total")} onClick={() => go("Registered")} />
            <KpiCard i={1} label="Selected" value={k.selected} delta={deltas.selected} sub={`${k.selRate}% of registered`} icon={<UserCheck className="h-4 w-4" />} color={V.aqua} spark={spark("selected")} onClick={() => go("Selected", { outcome: "selected" })} />
            <KpiCard i={2} label="Rejected" value={k.rejected} delta={deltas.rejected} deltaInvert sub={`${k.rejRate}% of registered`} icon={<UserX className="h-4 w-4" />} color={V.orange} spark={spark("rejected")} onClick={() => go("Rejected", { outcome: "rejected" })} />
            <KpiCard i={3} label="Joined" value={k.joined} delta={deltas.joined} sub={`${k.joinRate}% of registered`} icon={<Users className="h-4 w-4" />} color={V.violet} onClick={() => go("Joined", { outcome: "joined" })} />
            <KpiCard i={4} label="In process" value={k.waiting} delta={deltas.waiting} sub="still open in this window" icon={<Hourglass className="h-4 w-4" />} color={V.yellow} onClick={() => go("In process", { outcome: "waiting" })} />
            <KpiCard i={5} label="No-show rate" value={k.noShowRate} decimals={k.noShowRate % 1 ? 1 : 0} suffix="%" delta={deltas.noShowRate} deltaInvert sub={`${fmt(k.noShow)} candidates`} icon={<AlertTriangle className="h-4 w-4" />} color={V.red} onClick={() => go("No-shows", { outcome: "noShow" })} />
          </>)}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5" i={1} title="What stands out" hint="Click a finding to drill" icon={<Lightbulb className="h-4 w-4" />}>
          {cur.isLoading ? <Loading h="h-40" /> : cur.isError ? <Failed what="Findings" /> : <InsightList items={insights} />}
        </Card>
        <Card className="lg:col-span-7" i={2} title="Hiring funnel" hint="Registered to joined; click a step to list those candidates" icon={<Filter className="h-4 w-4" />}>
          {leak.isLoading ? <Loading h="h-40" /> : leak.isError ? <Failed what="The funnel" /> : leak.data?.stages.length && leak.data.stages[0].n > 0
            ? <Waterfall steps={leak.data.stages} onStep={(key) => { const s = leak.data!.stages.find((x) => x.key === key); go(s?.label ?? key, funnelFilter(key)); }} />
            : <Empty text="No candidates in this window" />}
        </Card>
      </div>

      <Card i={3} title="Daily trend" hint={d?.weekly ? "Outcomes per week" : "Outcomes per day"} icon={<TrendingUp className="h-4 w-4" />}>
        {cur.isLoading ? <Loading h="h-64" /> : cur.isError ? <Failed what="The trend" /> : d?.trend.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={d.trend} margin={{ left: -18, right: 6, top: 6 }}>
              <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="date" tick={tick} tickFormatter={(v) => String(v).slice(5, 10)} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tick={tick} allowDecimals={false} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} cursor={{ stroke: V.grid, strokeWidth: 1.5 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
              <Area type="monotone" dataKey="total" name="Registered" stroke={V.blue} strokeWidth={2} fill={V.blue} fillOpacity={0.15} />
              <Area type="monotone" dataKey="selected" name="Selected" stroke={V.aqua} strokeWidth={2} fill={V.aqua} fillOpacity={0.15} />
              <Area type="monotone" dataKey="rejected" name="Rejected" stroke={V.orange} strokeWidth={2} fill={V.orange} fillOpacity={0.15} />
            </AreaChart>
          </ResponsiveContainer>
        ) : <Empty />}
      </Card>

      <Section title="Where it is strong and where it is not" hint="Every cell and name drills one level down">
        <div className="grid gap-4 lg:grid-cols-2">
          {scorecard(procRows, "process", "Process", <GitBranch className="h-4 w-4" />, 4, "")}
          {scorecard(srcRows, "source", "Source", <Layers3 className="h-4 w-4" />, 5, "")}
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-4" i={6} title="Weekday pattern" hint="Candidates by day of week; click a bar" icon={<CalendarDays className="h-4 w-4" />}>
          {cur.isLoading ? <Loading /> : cur.isError ? <Failed what="The weekday pattern" /> : d?.weekday.some((w) => w.total) ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={d.weekday.map((w) => ({ ...w, label: DAY[w.dow] }))} margin={{ left: -20 }}>
                <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} /><YAxis tick={tick} allowDecimals={false} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} formatter={(v: number, n: string) => [n === "Selection %" ? `${v}%` : fmt(v), n]} />
                <Bar dataKey="total" name="Candidates" fill={V.blue} radius={[6, 6, 0, 0]} className="cursor-pointer" onClick={(p: { dow?: number }) => p.dow && go(DAY[p.dow], { dow: p.dow })} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Card>
        <Card className="lg:col-span-8" i={7} title="Arrival heat" hint="Registrations by day and hour; click a cell" icon={<Grid3x3 className="h-4 w-4" />}>
          {cur.isLoading ? <Loading /> : cur.isError ? <Failed what="The arrival heat" /> : grid.max > 0 ? (
            <div className="overflow-x-auto">
              <div className="grid min-w-[480px] gap-[3px]" style={{ gridTemplateColumns: `2.5rem repeat(${grid.hours.length}, minmax(0,1fr))` }}>
                <span />{grid.hours.map((h) => <span key={h} className="text-center text-[10px] text-muted-foreground">{h}</span>)}
                {grid.grid.map((row, r) => (
                  <div key={r} className="contents">
                    <span className="self-center text-[11px] text-muted-foreground">{DAY[r + 1]}</span>
                    {grid.hours.map((h) => (
                      <button key={h} onClick={() => row[h] && go(`${DAY[r + 1]} ${h}:00`, { dow: r + 1, hour: h })} disabled={!row[h]} title={`${DAY[r + 1]} ${h}:00 - ${fmt(row[h])}`} aria-label={`${DAY[r + 1]} ${h}:00, ${row[h]} candidates`}
                        className="h-7 cursor-pointer rounded-[4px] text-[10px] disabled:cursor-default" style={{ background: row[h] ? heatColor(row[h] / grid.max) : "var(--v-track)" }}>{row[h] || ""}</button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : <Empty text="No arrival data in this window" />}
        </Card>
      </div>

      <Card i={8} title="Where candidates wait" hint="Median and 90th-percentile hours in each stage; red marks the bottleneck" icon={<CalendarClock className="h-4 w-4" />}>
        {dwell.isLoading ? <Loading /> : dwell.isError ? <Failed what="Stage timings" /> : dwell.data?.stages.length ? (() => {
          const rows = dwell.data.stages.slice(0, 8).map((s) => ({ ...s, label: humanizeStage(s.stage) + (s.stage === dwell.data!.bottleneck ? " (bottleneck)" : "") }));
          return (
            <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 34)}>
              <BarChart layout="vertical" data={rows} margin={{ left: 8, right: 14 }}>
                <CartesianGrid stroke={V.grid} strokeDasharray="3 4" horizontal={false} />
                <XAxis type="number" tick={tick} axisLine={false} tickLine={false} unit=" h" /><YAxis type="category" dataKey="label" width={170} tick={tick} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} formatter={(v: number, n: string) => [`${v} h`, n]} />
                <Bar dataKey="medianHours" name="Median" radius={[0, 6, 6, 0]} className="cursor-pointer" onClick={(p: { stage?: string }) => p.stage && go(`In ${humanizeStage(p.stage)}`, { stage: p.stage })}>
                  {rows.map((s) => <Cell key={s.stage} fill={s.stage === dwell.data!.bottleneck ? V.red : V.blue} />)}
                </Bar>
                <Bar dataKey="p90Hours" name="90th percentile" fill={V.violet} fillOpacity={0.35} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          );
        })() : <Empty text="No stage history in this window" />}
      </Card>

      <Card i={9} title="Weekly cohorts" hint="Everyone who registered in a week, and where they stand now" icon={<Network className="h-4 w-4" />}
        right={cohorts.data && <ExportButton onClick={() => downloadCsv("ats-cohorts.csv", ["Week", "Registered", "Selected %", "Rejected %", "No-show %", "Joined %", "Median days to decision"], cohorts.data!.cohorts.map((c) => [c.week, c.total, c.selRate, c.rejRate, c.noShowRate, c.joinRate, c.medianDaysToDecision]))} />}>
        {cohorts.isLoading ? <Loading /> : cohorts.isError ? <Failed what="Cohorts" /> : cohorts.data?.cohorts.some((c) => c.total) ? (
          <HeatTable rows={cohorts.data.cohorts.filter((c) => c.total).slice().reverse().map((c) => ({ ...c, name: `Week of ${c.week}` }))} max={12}
            cols={[
              { key: "t", label: "Registered", get: (r) => r.total },
              { key: "s", label: "Selected %", get: (r) => r.selRate, format: pctFmt, hue: "green" },
              { key: "r", label: "Rejected %", get: (r) => r.rejRate, format: pctFmt, invert: true, hue: "red" },
              { key: "n", label: "No-show %", get: (r) => r.noShowRate, format: pctFmt, invert: true, hue: "red" },
              { key: "j", label: "Joined %", get: (r) => r.joinRate, format: pctFmt, hue: "green" },
              { key: "d", label: "Days to decide", get: (r) => r.medianDaysToDecision ?? 0, format: (n) => (n ? `${n}d` : "-"), invert: true, hue: "blue" },
            ]}
            onRow={(r) => drill.openDrill(r.name, { ...base, ...weekWindow(r.week) })} />
        ) : <Empty text="No registrations in the last 12 weeks" />}
      </Card>

      <DemandSupplyCard i={10} />
    </div>
  );
}

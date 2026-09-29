import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle, BadgeCheck, Building2, CalendarRange, Zap, CalendarClock, Clock, Filter, GitBranch, Grid3x3, HeartPulse, Info, Lightbulb, Radio, RefreshCcw,
  ShieldCheck, Sparkles, Timer, TrendingUp, Trophy, UserCheck, UserPlus, UserX, Users, Workflow, Handshake, LayoutDashboard,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAtsOverview, type AtsOverview, type OverviewPeriod } from "@/hooks/useAtsOverview";
import { periodFrom } from "@/components/ats/overview/shell";
import { useDrillActions } from "@/components/ats/overview/drill";
import { CountUp, Delta, Empty, Gauge, Panel, RateBar, Sparkline, V, VIZ_CSS, fmt, rise, tooltipStyle } from "@/components/ats/overview/viz";
import { FlowViz, FunnelViz, Heatmap, SourceTreemap, TrendViz } from "@/components/ats/overview/charts";

const OFFER_COLORS: Record<string, string> = { approved: V.aqua, rejected: V.orange };
const BGV_COLORS: Record<string, string> = { clear: V.aqua, refer: V.orange, negative: V.red };

function buildInsights(d: AtsOverview) {
  const out: { tone: "alert" | "win" | "note"; text: string; drill?: { crumb: string; extra: Record<string, unknown>; noPeriod?: boolean } }[] = [];
  const { kpis, queue } = d;
  if (queue.slaBreach > 0) out.push({ tone: "alert", text: `${queue.slaBreach} candidate(s) waiting past the ${queue.slaMinutes}-min SLA right now (avg wait ${queue.avgWaitMin} min).`, drill: { crumb: "Waiting today", extra: { outcome: "waiting", from: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) }, noPeriod: true } });
  const stale = d.aging.find((a) => a.bucket === "15d+")?.n || 0;
  if (stale > 0) out.push({ tone: "alert", text: `${fmt(stale)} open candidates untouched for 15+ days. Re-engage or close them.`, drill: { crumb: "Idle 15d+", extra: { idle: "15d+" }, noPeriod: true } });
  if (d.dropoff[0]) out.push({ tone: "note", text: `Most rejections follow "${d.dropoff[0].stage}" (${fmt(d.dropoff[0].n)} candidates).`, drill: { crumb: `Rejected after ${d.dropoff[0].stage}`, extra: { stage: d.dropoff[0].stage.startsWith("Applied") ? "Applied" : d.dropoff[0].stage, outcome: "rejected" } } });
  const best = [...d.sources].filter((s) => s.total >= 10).sort((a, b) => b.convRate - a.convRate)[0];
  if (best) out.push({ tone: "win", text: `${best.name} is the best source: ${best.convRate}% selection across ${fmt(best.total)} candidates.`, drill: { crumb: `Source: ${best.name}`, extra: { source: best.name } } });
  if (kpis.noShowRate > 15) out.push({ tone: "alert", text: `${kpis.noShowRate}% of engaged candidates were no-shows (${fmt(kpis.noShow)}).`, drill: { crumb: "No-shows", extra: { outcome: "noShow" } } });
  if (kpis.offersTotal > 0 && kpis.offerApprovalRate < 90) out.push({ tone: "alert", text: `Only ${kpis.offerApprovalRate}% of offers cleared branch-head approval.` });
  if (kpis.bgvFlagRate > 20) out.push({ tone: "alert", text: `${kpis.bgvFlagRate}% of background checks need referral or came back negative.` });
  if (kpis.leads > 0) out.push({ tone: "note", text: `${fmt(kpis.leads)} imported leads have not engaged yet; they are excluded from the numbers above.` });
  if (kpis.duplicateUnresolved > 0) out.push({ tone: "note", text: `${kpis.duplicateUnresolved} duplicate-candidate flag(s) still unresolved.` });
  if (kpis.walkoutRate > 15) out.push({ tone: "alert", text: `${kpis.walkoutRate}% of today's walk-ins left before their interview.` });
  return out.slice(0, 6);
}

const DAY_NAMES = ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FUNNEL_DRILL: Record<string, Record<string, unknown>> = { Selected: { outcome: "selected" }, "Offer approved": { outcome: "offered" }, Joined: { outcome: "joined" } };
const FLOW_DRILL: Record<string, Record<string, unknown>> = { Selected: { outcome: "selected" }, "Awaiting joining": { outcome: "selected" }, Rejected: { outcome: "rejected" }, "No-show": { outcome: "noShow" }, Joined: { outcome: "joined" }, "In progress": { outcome: "waiting" } };

const TONE = {
  alert: { Icon: AlertTriangle, label: "Alert", cls: "border-l-amber-500 text-amber-700 dark:text-amber-300" },
  win: { Icon: BadgeCheck, label: "Win", cls: "border-l-emerald-500 text-emerald-700 dark:text-emerald-300" },
  note: { Icon: Info, label: "Note", cls: "border-l-blue-500 text-blue-700 dark:text-blue-300" },
};

interface StatTileProps {
  onClick?: () => void; label: string; value: number; sub: string; icon: LucideIcon; color: string; delta?: number | null;
  spark?: Record<string, unknown>[]; sparkKey?: string; ring?: number; i: number;
}

function StatTile({ label, value, sub, icon: Icon, color, delta, spark, sparkKey, ring, i, onClick }: StatTileProps) {
  return (
    <div {...(onClick ? { role: "button", tabIndex: 0, onClick, onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && onClick(), "aria-label": `${label}: drill down` } : {})} className={`v-card v-rise rounded-2xl border bg-card p-4 text-card-foreground shadow-sm ${onClick ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" : ""}`} style={rise(i)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }} aria-hidden><Icon className="h-4 w-4" /></span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="text-3xl font-semibold tracking-tight"><CountUp value={value} /></div>
        <Delta v={delta} />
      </div>
      <div className="mb-1 mt-0.5 text-xs text-muted-foreground">{sub}</div>
      {spark && sparkKey ? <Sparkline data={spark} dataKey={sparkKey} color={color} /> : <div className="pt-4"><RateBar value={ring ?? 0} color={color} /></div>}
    </div>
  );
}

function Donut({ data, colorOf, center }: { data: { name: string; n: number }[]; colorOf: (n: string, i: number) => string; center: string }) {
  const total = data.reduce((a, x) => a + x.n, 0);
  return (
    <div>
      <div className="relative h-40">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart><Pie data={data} dataKey="n" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={3} cornerRadius={6} stroke="hsl(var(--card))" strokeWidth={2}>
            {data.map((r, i) => <Cell key={r.name} fill={colorOf(r.name, i)} />)}
          </Pie><Tooltip {...tooltipStyle} /></PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-xl font-semibold tabular-nums">{fmt(total)}</span><span className="text-[11px] text-muted-foreground">{center}</span></div>
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {data.map((r, i) => <li key={r.name} className="flex items-center justify-between gap-1"><span className="flex items-center gap-1.5 capitalize"><span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(r.name, i) }} aria-hidden />{r.name}</span><span className="tabular-nums text-muted-foreground">{fmt(r.n)}</span></li>)}
      </ul>
    </div>
  );
}

const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");

/** Insights > Overview: KPIs, health, funnel, flow, weekly/weekday trends, movers and anomalies. Every element drills down. */
export function InsightsOverviewSection({ period, branch }: { period: OverviewPeriod; branch: string }) {
  const { data: d, isLoading, isFetching, isError, error } = useAtsOverview(period, branch);
  const drill = useDrillActions();
  const insights = useMemo(() => (d ? buildInsights(d) : []), [d]);
  const q = d?.queue;
  const slaOk = q ? (q.active ? Math.round(((q.active - q.slaBreach) / q.active) * 1000) / 10 : 100) : 0;
  const bgvTotal = d?.bgv.reduce((a, b) => a + b.n, 0) ?? 0;
  const offerData = d ? Object.entries(d.offers.byStatus).map(([name, n]) => ({ name, n })) : [];
  const maxRec = Math.max(1, ...(d?.recruiters.map((r) => r.selected) ?? [1]));
  const base = { from: periodFrom(period), branch: branch || undefined }; const go = (crumb: string, extra: Record<string, unknown> = {}) => drill.openDrill(crumb, { ...base, ...extra });

  return (
    <>
        {isError && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">Could not load dashboard: {(error as Error)?.message}</div>}

        {isLoading || !d ? (
          <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>
            <div className="grid gap-4 lg:grid-cols-12"><Skeleton className="h-80 rounded-2xl lg:col-span-5" /><Skeleton className="h-80 rounded-2xl lg:col-span-7" /></div>
          </div>
        ) : (
          <div className={`space-y-4 transition-opacity duration-200 ${isFetching ? "opacity-80" : ""}`}>
            {/* KPI tiles */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile onClick={() => go("Registered")} i={0} label="Registered" icon={UserPlus} color={V.blue} value={d.kpis.registered.value} delta={d.kpis.registered.delta} sub={`${fmt(d.kpis.inProcess.value)} waiting or on hold`} spark={d.trend} sparkKey="registered" />
              <StatTile onClick={() => go("Selected", { outcome: "selected" })} i={1} label="Selected" icon={UserCheck} color={V.aqua} value={d.kpis.selected.value} delta={d.kpis.selected.delta} sub={`${d.kpis.selected.rate}% selection rate`} spark={d.trend} sparkKey="selected" />
              <StatTile onClick={() => go("Rejected", { outcome: "rejected" })} i={2} label="Rejected" icon={UserX} color={V.orange} value={d.kpis.rejected.value} delta={d.kpis.rejected.delta} sub={`${d.kpis.rejected.rate}% of registered`} spark={d.trend} sparkKey="rejected" />
              <StatTile onClick={() => go("Joined", { outcome: "joined" })} i={3} label="Joined" icon={Users} color={V.violet} value={d.kpis.joined.value} delta={d.kpis.joined.delta} sub={`${d.kpis.joined.rate}% of selected joined`} ring={d.kpis.joined.rate} />
            </div>

            {/* Scorecard + insights */}
            <div className="grid gap-4 lg:grid-cols-12">
              <Panel i={4} className="lg:col-span-7" title="Health scorecard" hint="Five signals that tell you if the funnel is healthy" icon={<HeartPulse className="h-4 w-4" />}>
                <div className="grid grid-cols-2 gap-y-4 sm:grid-cols-3 xl:grid-cols-5">
                  <Gauge value={d.kpis.selected.rate ?? 0} color={V.aqua} label="Selection rate" sub="of registered" />
                  <Gauge value={Math.round((100 - d.kpis.noShowRate) * 10) / 10} color={V.violet} label="Show-up rate" sub={`${fmt(d.kpis.noShow)} no-shows`} />
                  <Gauge value={d.kpis.offerApprovalRate} color={V.blue} label="Offers approved" sub={`${fmt(d.kpis.offersTotal)} offers`} />
                  <Gauge value={d.kpis.bgvClearRate} color={V.aqua} label="BGV clear" sub={`${fmt(bgvTotal)} reports`} />
                  <Gauge value={slaOk} color={slaOk >= 90 ? V.aqua : V.orange} label="Queue SLA met" sub={`${q?.active ?? 0} waiting`} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
                  <div className="flex items-center gap-2"><Timer className="h-4 w-4 text-primary" aria-hidden /><span className="text-muted-foreground">Time to select</span><b className="ml-auto tabular-nums">{d.kpis.hrsToSelect}h</b></div>
                  <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-primary" aria-hidden /><span className="text-muted-foreground">Avg queue wait</span><b className="ml-auto tabular-nums">{d.queue.avgWaitMin}m</b></div>
                </div>
              </Panel>
              <Panel i={5} className="lg:col-span-5" title="What needs attention" hint="Auto-detected from live data" icon={<Lightbulb className="h-4 w-4" />}>
                {insights.length ? (
                  <ul className="space-y-2">
                    {insights.map((x, k) => { const t = TONE[x.tone]; const inner = (<>
                        <t.Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <span className="text-foreground"><b className="mr-1 text-[11px] uppercase tracking-wide">{t.label}</b>{x.text}</span></>); return (
                      <li key={k}>{x.drill
                        ? <button onClick={() => x.drill!.noPeriod ? drill.openDrill(x.drill!.crumb, { branch: branch || undefined, ...x.drill!.extra }) : go(x.drill!.crumb, x.drill!.extra)} className={`flex w-full cursor-pointer items-start gap-2 rounded-lg border-l-4 bg-muted/40 px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${t.cls}`}>{inner}</button>
                        : <div className={`flex items-start gap-2 rounded-lg border-l-4 bg-muted/40 px-3 py-2 text-sm ${t.cls}`}>{inner}</div>}</li>); })}
                  </ul>
                ) : <Empty text="All clear. Nothing needs attention." />}
              </Panel>
            </div>

            {/* Funnel + trend */}
            <div className="grid gap-4 lg:grid-cols-12">
              <Panel i={6} className="lg:col-span-5" title="Hiring funnel" hint="Applied to joined; chips show step conversion" icon={<Filter className="h-4 w-4" />}><FunnelViz data={d.funnel[0]?.n === d.funnel[1]?.n ? d.funnel.slice(1) : d.funnel} onSelect={(st) => go(st, FUNNEL_DRILL[st] ?? {})} /></Panel>
              <Panel i={7} className="lg:col-span-7" title="Daily trend" hint="Outcomes per day with a 7-day average" icon={<TrendingUp className="h-4 w-4" />}><TrendViz data={d.trend} /></Panel>
            </div>

            {/* Deeper analytics */}
            <div className="grid gap-4 lg:grid-cols-12">
              <Panel i={7} className="lg:col-span-5" title="Weekly trend" hint="Last 12 weeks · click a week to drill" icon={<CalendarRange className="h-4 w-4" />}>
                {d.weekly.length ? (
                  <>
                    <ResponsiveContainer width="100%" height={210}>
                      <BarChart data={d.weekly} margin={{ left: -18, right: 6 }}>
                        <XAxis dataKey="week" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} labelFormatter={(v) => `Week of ${v}`} />
                        {(["registered", "selected"] as const).map((k, idx) => <Bar key={k} dataKey={k} name={k === "registered" ? "Registered" : "Selected"} fill={idx ? V.aqua : V.blue} radius={[5, 5, 0, 0]} className="cursor-pointer"
                          onClick={(p: { week?: string }) => { if (!p.week) return; const end = new Date(`${p.week}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 6); drill.openDrill(`Week of ${p.week}`, { branch: branch || undefined, from: p.week, to: end.toISOString().slice(0, 10) }); }} />)}
                      </BarChart>
                    </ResponsiveContainer>
                    {d.weekly.length > 1 && (() => { const a = d.weekly[d.weekly.length - 2], b = d.weekly[d.weekly.length - 1]; const dl = a.selRate ? Math.round((b.selRate - a.selRate) * 10) / 10 : 0; return <p className="text-xs text-muted-foreground">Latest week selection rate <b className="text-foreground">{b.selRate}%</b> ({dl >= 0 ? "+" : ""}{dl} pts vs prior week). Current week is partial.</p>; })()}
                  </>
                ) : <Empty />}
              </Panel>
              <Panel i={8} className="lg:col-span-4" title="Weekday pattern" hint="Volume and selection rate by weekday" icon={<CalendarClock className="h-4 w-4" />}>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={d.weekday.map((w) => ({ ...w, label: DAY_NAMES[w.dow] }))} margin={{ left: -18, right: 6 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} formatter={(v: number, _n, item) => [`${v} registered · ${(item.payload as { selRate: number }).selRate}% selected`, ""]} />
                    <Bar dataKey="registered" name="Registered" radius={[6, 6, 0, 0]} className="cursor-pointer" onClick={(p: { dow?: number }) => p.dow && go(`${DAY_NAMES[p.dow]} arrivals`, { dow: p.dow })}>
                      {d.weekday.map((w) => <Cell key={w.dow} fill={w.selRate === Math.max(...d.weekday.map((x) => x.selRate)) && w.registered > 0 ? V.aqua : V.blue} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs text-muted-foreground">Green bar = weekday with the highest selection rate.</p>
              </Panel>
              <Panel i={9} className="lg:col-span-3" title="Month projection" hint={`Run-rate for ${d.runRate.month}`} icon={<Zap className="h-4 w-4" />}>
                <div className="text-3xl font-semibold tracking-tight tabular-nums">{fmt(d.runRate.projectedRegistered)}</div>
                <div className="text-xs text-muted-foreground">projected registrations · {fmt(d.runRate.mtdRegistered)} so far</div>
                <div className="my-2"><RateBar value={d.runRate.projectedRegistered ? (d.runRate.mtdRegistered / d.runRate.projectedRegistered) * 100 : 0} color={V.blue} /></div>
                <ul className="space-y-1 text-xs"><li className="flex justify-between"><span className="text-muted-foreground">Projected selections</span><b className="tabular-nums">{fmt(d.runRate.projectedSelected)}</b></li>
                  <li className="flex justify-between"><span className="text-muted-foreground">7-day daily average</span><b className="tabular-nums">{d.runRate.dailyAvg7}</b></li>
                  <li className="flex justify-between"><span className="text-muted-foreground">Day of month</span><b className="tabular-nums">{d.runRate.dayOfMonth} / {d.runRate.daysInMonth}</b></li></ul>
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel i={10} title="Branch movers" hint={period === "all" ? "Pick a period to compare against the one before" : "Change against the previous period of the same length"} icon={<TrendingUp className="h-4 w-4" />}>
                {d.movers.all.length ? (
                  <div className="overflow-x-auto"><table className="w-full text-sm text-card-foreground"><thead className="text-xs text-muted-foreground"><tr><th className="py-1.5 text-left font-medium">Branch</th><th className="text-right font-medium">Volume</th><th className="text-right font-medium">Change</th><th className="text-right font-medium">Sel. rate</th><th className="text-right font-medium">Change</th></tr></thead>
                    <tbody>{[...d.movers.all].sort((a, b) => (b.volumeDelta ?? -999) - (a.volumeDelta ?? -999)).map((m) => (
                      <tr key={m.name} tabIndex={0} role="button" aria-label={`Drill into ${m.name}`} onClick={() => go(`Branch: ${m.name}`, { branch: m.name })} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && go(`Branch: ${m.name}`, { branch: m.name })} className="cursor-pointer border-t transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                        <td className="py-2 font-medium">{m.name}</td><td className="text-right tabular-nums">{fmt(m.total)}</td><td className="text-right"><Delta v={m.volumeDelta} /></td>
                        <td className="text-right tabular-nums">{m.selRate}%</td><td className="text-right">{m.selRateDelta == null ? <span className="text-xs text-muted-foreground">-</span> : <span className={`text-xs font-semibold tabular-nums ${m.selRateDelta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{m.selRateDelta >= 0 ? "▲" : "▼"} {Math.abs(m.selRateDelta)} pts</span>}</td></tr>))}</tbody></table></div>
                ) : <Empty text="No previous period to compare" />}
              </Panel>
              <Panel i={11} title="Unusual days" hint="Registrations more than 2 standard deviations from normal" icon={<AlertTriangle className="h-4 w-4" />}>
                {d.anomalies.length ? (
                  <ul className="space-y-2">{d.anomalies.map((a) => (
                    <li key={a.date}><button onClick={() => drill.openDrill(`Arrivals on ${a.date}`, { branch: branch || undefined, from: a.date, to: a.date })} className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                      <span><span className="font-medium">{new Date(`${a.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" })}</span><span className="ml-2 text-xs text-muted-foreground">{fmt(a.value)} registered</span></span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.z > 0 ? "bg-blue-500/15 text-blue-700 dark:text-blue-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>{a.z > 0 ? "Spike" : "Drought"} · {a.z > 0 ? "+" : ""}{a.z}σ</span></button></li>))}</ul>
                ) : <Empty text="No unusual days in this period" />}
              </Panel>
            </div>

            {/* Flow + sources */}
            <div className="grid gap-4 lg:grid-cols-12">
              <Panel i={8} className="lg:col-span-6" title="Candidate flow" hint="Where every registered candidate ended up" icon={<Workflow className="h-4 w-4" />}><FlowViz d={d} onSelect={(n) => go(n, FLOW_DRILL[n] ?? {})} /></Panel>
              <Panel i={9} className="lg:col-span-6" title="Source quality" hint="Box size = volume, shade = selection conversion" icon={<GitBranch className="h-4 w-4" />}><SourceTreemap data={d.sources} onSelect={(n) => go(`Source: ${n}`, { source: n })} /></Panel>
            </div>

            {/* Queue / heatmap / drop-off / aging */}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Panel i={10} title="Live queue" hint={`Today · SLA ${q!.slaMinutes} min`} icon={<Radio className="h-4 w-4" />}>
                <div className="flex items-end gap-2"><span className="text-5xl font-semibold tracking-tight"><CountUp value={q!.active} /></span><span className="mb-2 text-sm text-muted-foreground">waiting now</span></div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  {[["SLA breach", q!.slaBreach, q!.slaBreach ? "text-red-600 dark:text-red-400" : ""], ["Completed", q!.completed, ""], ["Walked out", q!.walkedOut, ""]].map(([l, v, c]) => (
                    <div key={l as string} className="rounded-xl bg-muted/50 p-2"><div className={`text-lg font-semibold tabular-nums ${c}`}>{fmt(v as number)}</div><div className="text-muted-foreground">{l}</div></div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Avg wait {q!.avgWaitMin} min · walk-out rate {d.kpis.walkoutRate}%</p>
              </Panel>
              <Panel i={11} className="xl:col-span-1" title="Arrival heatmap" hint="When candidates walk in" icon={<Grid3x3 className="h-4 w-4" />}><Heatmap data={d.heatmap} onSelect={(dow, hour) => go(`${DAY_NAMES[dow]} ${hour}:00 arrivals`, { dow, hour })} /></Panel>
              <Panel i={12} title="Where candidates drop" hint="Stage before rejection" icon={<UserX className="h-4 w-4" />}>
                {d.dropoff.length ? (
                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart data={d.dropoff} layout="vertical" margin={{ left: 0, right: 12 }}>
                      <XAxis type="number" hide /><YAxis type="category" dataKey="stage" width={96} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} /><Bar dataKey="n" name="Rejected" fill={V.orange} radius={[0, 8, 8, 0]} barSize={16} className="cursor-pointer" onClick={(p: { stage?: string }) => p.stage && go(`Rejected after ${p.stage}`, { stage: p.stage.startsWith("Applied") ? "Applied" : p.stage, outcome: "rejected" })} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <Empty />}
              </Panel>
              <Panel i={13} title="Pipeline aging" hint="Days since last movement" icon={<CalendarClock className="h-4 w-4" />}>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={d.aging} margin={{ left: -22, right: 4 }}>
                    <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} axisLine={false} tickLine={false} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} />
                    <Bar dataKey="n" name="Candidates" radius={[8, 8, 0, 0]} className="cursor-pointer" onClick={(p: { bucket?: string }) => p.bucket && drill.openDrill(`Idle ${p.bucket}`, { branch: branch || undefined, idle: p.bucket })}>{d.aging.map((a, i) => <Cell key={a.bucket} fill={i >= 3 ? V.orange : V.blue} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
            </div>

            {/* Branch + recruiters */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel i={14} title="Branch performance" hint="Volume and selection rate" icon={<Building2 className="h-4 w-4" />}>
                {d.branches.length ? (
                  <div className="max-h-80 overflow-auto"><table className="w-full text-sm text-card-foreground [&_td]:text-card-foreground">
                    <thead className="sticky top-0 bg-card text-xs text-muted-foreground"><tr><th className="py-1.5 text-left font-medium">Branch</th><th className="text-right font-medium">Total</th><th className="text-right font-medium">Sel</th><th className="text-right font-medium">Rej</th><th className="w-28 pl-4 text-left font-medium">Sel %</th></tr></thead>
                    <tbody>{d.branches.map((b) => (
                      <tr key={b.name} tabIndex={0} role="button" aria-label={`Drill into ${b.name}`} onClick={() => go(`Branch: ${b.name}`, { branch: b.name })} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && go(`Branch: ${b.name}`, { branch: b.name })} className="cursor-pointer border-t transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"><td className="py-2 font-medium">{b.name}</td><td className="text-right tabular-nums">{fmt(b.total)}</td><td className="text-right tabular-nums">{fmt(b.selected)}</td><td className="text-right tabular-nums">{fmt(b.rejected)}</td>
                        <td className="pl-4"><div className="flex items-center gap-2"><div className="flex-1"><RateBar value={b.selRate} color={V.aqua} /></div><span className="w-10 text-right text-xs tabular-nums">{b.selRate}%</span></div></td></tr>))}</tbody>
                  </table></div>
                ) : <Empty />}
              </Panel>
              <Panel i={15} title="Recruiter leaderboard" hint="Ranked by selections" icon={<Trophy className="h-4 w-4" />}>
                {d.recruiters.length ? (
                  <ol className="max-h-80 space-y-2 overflow-auto pr-1">
                    {[...d.recruiters].sort((a, b) => b.selected - a.selected).map((r, k) => (
                      <li key={r.name} tabIndex={0} role="button" aria-label={`Drill into ${r.name}`} onClick={() => go(`Recruiter: ${r.name}`, { recruiter: r.name })} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && go(`Recruiter: ${r.name}`, { recruiter: r.name })} className="flex cursor-pointer items-center gap-3 rounded-xl p-1.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                        <span className="w-5 text-center text-xs font-semibold text-muted-foreground">{k + 1}</span>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden>{initials(r.name)}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between text-sm"><span className="truncate font-medium">{r.name}</span><span className="tabular-nums text-muted-foreground">{fmt(r.selected)} sel · {r.selRate}%</span></div>
                          <RateBar value={(r.selected / maxRec) * 100} color={V.violet} />
                          <div className="mt-0.5 text-[11px] text-muted-foreground">{fmt(r.total)} handled · {fmt(r.joined)} joined</div>
                        </div>
                      </li>))}
                  </ol>
                ) : <Empty />}
              </Panel>
            </div>

            {/* Offers / BGV / process / diversity */}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Panel i={16} title="Offers" hint="Branch-head approval outcome" icon={<Handshake className="h-4 w-4" />}>
                {offerData.length ? (
                  <>
                    <Donut data={offerData} colorOf={(n) => OFFER_COLORS[n] || V.blue} center="offers" />
                    {d.offers.declineReasons.length > 0 && (
                      <div className="mt-3 border-t pt-2 text-xs"><div className="mb-1 font-medium">Top decline reasons</div>
                        {d.offers.declineReasons.map((r) => <div key={r.reason} className="flex justify-between py-0.5"><span className="truncate pr-2">{r.reason}</span><span className="tabular-nums text-muted-foreground">{r.n}</span></div>)}</div>
                    )}
                  </>
                ) : <Empty />}
              </Panel>
              <Panel i={17} title="Background verification" hint="Report status" icon={<ShieldCheck className="h-4 w-4" />}>
                {d.bgv.length ? (
                  <ul className="space-y-3">{d.bgv.map((b) => (
                    <li key={b.status}><div className="mb-1 flex justify-between text-sm"><span className="capitalize">{b.status.replace("_", " ")}</span><span className="tabular-nums text-muted-foreground">{fmt(b.n)}{b.avgTatDays != null && ` · ${b.avgTatDays}d TAT`}</span></div>
                      <RateBar value={bgvTotal ? (b.n / bgvTotal) * 100 : 0} color={BGV_COLORS[b.status] ?? V.blue} /></li>))}</ul>
                ) : <Empty />}
              </Panel>
              <Panel i={18} title="Process demand" hint="Applicants vs selected" icon={<Sparkles className="h-4 w-4" />}>
                {d.processes.length ? (
                  <ul className="space-y-3">{d.processes.slice(0, 7).map((p) => (
                    <li key={p.name}><button onClick={() => go(`Process: ${p.name}`, { process: p.name })} aria-label={`Drill into ${p.name}`} className="-mx-1.5 block w-[calc(100%+0.75rem)] cursor-pointer rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><div className="mb-1 flex justify-between text-sm"><span className="truncate pr-2 font-medium">{p.name}</span><span className="tabular-nums text-muted-foreground">{fmt(p.selected)}/{fmt(p.total)}</span></div>
                      <RateBar value={p.selRate} color={V.blue} /></button></li>))}</ul>
                ) : <Empty />}
              </Panel>
              <Panel i={19} title="Candidate mix" hint="By gender" icon={<Users className="h-4 w-4" />}>
                {d.demographics.length ? <Donut data={d.demographics.map((x) => ({ name: x.name.toLowerCase(), n: x.n }))} colorOf={(_n, i) => [V.blue, V.aqua, V.orange, V.violet][i % 4]} center="candidates" /> : <Empty />}
              </Panel>
            </div>
          </div>
        )}
    </>
  );
}

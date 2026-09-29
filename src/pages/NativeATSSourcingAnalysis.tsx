import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Archive, Copy, Filter, GitBranch, Phone, PhoneOff, Send, Timer, TrendingUp, Trophy, UserCheck, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { useAtsSourcing, useHiringTrend, useSourceRoi, useTimeToHire } from "@/hooks/useAtsDashboards";
import { useAtsOverview, type OverviewPeriod } from "@/hooks/useAtsOverview";
import { DashboardFrame, Hero, PeriodToggle, periodFrom } from "@/components/ats/overview/shell";
import { BarRows, Empty, MiniStat, Panel, RateBar, V, fmt, tooltipStyle } from "@/components/ats/overview/viz";
import { FunnelViz, SourceTreemap } from "@/components/ats/overview/charts";

const tick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const STAGE_KEY: Record<string, string | undefined> = { Sourced: undefined, Contacted: "contacted", "Walked in": "walkin", Selected: "selected", Joined: "joined" };
const SERIES = [V.blue, V.aqua, V.orange, V.violet, V.yellow];
const monthLabel = (m: unknown) => new Date(`${String(m)}-01`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });

export default function NativeATSSourcingAnalysis() {
  const [period, setPeriod] = useState<OverviewPeriod>("all");
  const { data: d, isLoading, isFetching, isError, error, refetch } = useAtsSourcing(period);
  const { data: ov } = useAtsOverview(period === "all" ? "90d" : period, "");

  const trendMonths = (d?.trend ?? []).map((t) => String(t.month));
  const momentumMonths = trendMonths.slice(-2);
  const momentum = d && momentumMonths.length === 2 ? d.seriesNames.map((name) => {
    const prev = Number(d.trend.find((t) => t.month === momentumMonths[0])?.[name] ?? 0), last = Number(d.trend.find((t) => t.month === momentumMonths[1])?.[name] ?? 0);
    return { name, prev, last, change: prev ? Math.round(((last - prev) / prev) * 100) : null };
  }).filter((m) => m.prev || m.last) : [];
  const roi = useSourceRoi();
  const tth = useTimeToHire();
  const trend6 = useHiringTrend(6);
  const uncontacted = d ? Math.max(0, d.totals.sourced - d.totals.contacted) : 0;

  return (
    <DashboardLayout>
      <DashboardFrame hero={
        <Hero eyebrow="Talent Acquisition" title="Sourcing Analysis" active="Sourcing" fetching={isFetching} onRefresh={() => void refetch()}
          subtitle="Recruiter call-log funnel: sourced, contacted, walked in, selected, joined"
          controls={<PeriodToggle value={period} onChange={setPeriod} options={[{ key: "7d", label: "7D" }, { key: "30d", label: "30D" }, { key: "90d", label: "90D" }, { key: "all", label: "All" }]} />} />
      }>
        {(drill) => { const legacy = { notSource: "Walk-in" }; const leads = (crumb: string, f: Record<string, string | undefined>) => drill.openLeads(crumb, f); return (<>
        {isError && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">Could not load sourcing data: {(error as Error)?.message}</div>}
        {isLoading || !d ? (
          <div className="space-y-4" aria-busy="true"><div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div><Skeleton className="h-80 rounded-2xl" /></div>
        ) : (
          <div className={`space-y-4 transition-opacity duration-200 ${isFetching ? "opacity-80" : ""}`}>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <MiniStat onClick={() => leads("Leads sourced", legacy)} i={0} label="Leads sourced" icon={<Send className="h-4 w-4" />} color={V.blue} value={fmt(d.totals.sourced)} sub="Job portals, database, referrals" />
              <MiniStat onClick={() => leads("Contacted leads", { ...legacy, stage: "contacted" })} i={1} label="Contact rate" icon={<Phone className="h-4 w-4" />} color={V.aqua} value={`${d.totals.sourced ? Math.round((d.totals.contacted / d.totals.sourced) * 1000) / 10 : 0}%`} sub={`${fmt(uncontacted)} never contacted`} />
              <MiniStat onClick={() => leads("Walked-in leads", { ...legacy, stage: "walkin" })} i={2} label="Walk-in conversion" icon={<Users className="h-4 w-4" />} color={V.violet} value={`${d.totals.contacted ? Math.round((d.totals.walkin / d.totals.contacted) * 1000) / 10 : 0}%`} sub={`${fmt(d.totals.walkin)} walked in`} />
              <MiniStat onClick={() => leads("Selected leads", { ...legacy, stage: "selected" })} i={3} label="Selected from sourced leads" icon={<UserCheck className="h-4 w-4" />} color={V.orange} value={fmt(d.totals.selected)} sub={`${fmt(d.totals.joined)} joined`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-12">
              <Panel i={4} className="lg:col-span-5" title="Sourcing funnel" hint="Recruiter-sourced leads only" icon={<Filter className="h-4 w-4" />}><FunnelViz data={d.funnel} onSelect={(st) => leads(`Funnel: ${st}`, { ...legacy, stage: STAGE_KEY[st] })} /></Panel>
              <Panel i={5} className="lg:col-span-7" title="Monthly lead volume by source" hint="Top five sources" icon={<GitBranch className="h-4 w-4" />}>
                {d.trend.length ? (
                  <ResponsiveContainer width="100%" height={270}>
                    <BarChart data={d.trend} margin={{ left: -10, right: 6 }}>
                      <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="month" tick={tick} tickFormatter={monthLabel} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip {...tooltipStyle} labelFormatter={monthLabel} cursor={{ fill: V.track }} /><Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                      {d.seriesNames.map((n, i) => <Bar key={n} dataKey={n} stackId="s" className="cursor-pointer" onClick={(p: { month?: string }) => p.month && leads(`${n} · ${monthLabel(p.month)}`, { source: n, month: p.month })} fill={SERIES[i % SERIES.length]} stroke="hsl(var(--card))" strokeWidth={2} />)}
                    </BarChart>
                  </ResponsiveContainer>
                ) : <Empty />}
              </Panel>
            </div>

            <Panel i={6} title="Source momentum" hint="Latest month against the month before · click to see the leads" icon={<GitBranch className="h-4 w-4" />}>
              {momentum.length ? (
                <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-sm text-card-foreground"><thead className="text-xs text-muted-foreground"><tr><th className="py-1.5 text-left font-medium">Source</th><th className="text-right font-medium">{monthLabel(momentumMonths[0])}</th><th className="text-right font-medium">{monthLabel(momentumMonths[1])}</th><th className="text-right font-medium">Change</th></tr></thead>
                  <tbody>{momentum.map((m) => (
                    <tr key={m.name} tabIndex={0} role="button" aria-label={`Drill into ${m.name}`} onClick={() => leads(`${m.name} · ${monthLabel(momentumMonths[1])}`, { source: m.name, month: momentumMonths[1] })} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && leads(`${m.name} · ${monthLabel(momentumMonths[1])}`, { source: m.name, month: momentumMonths[1] })} className="cursor-pointer border-t transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                      <td className="py-2 font-medium">{m.name}</td><td className="text-right tabular-nums">{fmt(m.prev)}</td><td className="text-right tabular-nums">{fmt(m.last)}</td>
                      <td className="text-right">{m.change == null ? <span className="text-xs text-muted-foreground">new</span> : <span className={`text-xs font-semibold tabular-nums ${m.change >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{m.change >= 0 ? "▲" : "▼"} {Math.abs(m.change)}%</span>}</td></tr>))}</tbody></table></div>
              ) : <Empty text="Need at least two months of data" />}
            </Panel>

            <Panel i={6} title="Source comparison" hint="Rates are relative to leads sourced from that source" icon={<GitBranch className="h-4 w-4" />}>
              <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm text-card-foreground">
                <thead className="text-xs text-muted-foreground"><tr><th className="py-1.5 text-left font-medium">Source</th><th className="text-right font-medium">Sourced</th><th className="text-right font-medium">Contacted</th><th className="text-right font-medium">Walked in</th><th className="text-right font-medium">Selected</th><th className="text-right font-medium">Joined</th><th className="w-44 pl-4 text-left font-medium">Contact · walk-in rate</th></tr></thead>
                <tbody>{d.sources.map((s) => (
                  <tr key={s.name} className="border-t transition-colors hover:bg-muted/50">
                    <td className="py-2 font-medium">{s.name}{s.name === "Walk-in" && <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">bulk import</span>}</td>
                    {([["", s.sourced], ["contacted", s.contacted], ["walkin", s.walkin], ["selected", s.selected], ["joined", s.joined]] as const).map(([st, v]) => (
                      <td key={st} className="text-right tabular-nums"><button onClick={() => leads(`${s.name}${st ? ` · ${st}` : ""}`, { source: s.name, stage: st || undefined })} disabled={!v} aria-label={`${s.name} ${st || "sourced"}: ${fmt(v)}`} className="cursor-pointer rounded px-1.5 py-0.5 hover:bg-primary/10 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default disabled:hover:bg-transparent">{fmt(v)}</button></td>))}
                    <td className="pl-4"><div className="space-y-1"><RateBar value={s.contactRate} color={V.aqua} /><RateBar value={s.walkinRate} color={V.violet} /><div className="text-[10px] text-muted-foreground">{s.contactRate}% contacted · {s.walkinRate}% walked in</div></div></td>
                  </tr>))}</tbody>
              </table></div>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-12">
              <Panel i={7} className="lg:col-span-7" title="Hires by channel" hint="Registered candidates in the ATS: share who became employees (stage or employee-record match)" icon={<UserCheck className="h-4 w-4" />}>
                {roi.data?.length ? (
                  <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-sm text-card-foreground"><thead className="text-xs text-muted-foreground"><tr><th className="py-1.5 text-left font-medium">Channel</th><th className="text-right font-medium">Candidates</th><th className="text-right font-medium">Hired</th><th className="w-40 pl-4 text-left font-medium">Conversion</th></tr></thead>
                    <tbody>{roi.data.map((r) => (
                      <tr key={r.source_channel} tabIndex={0} role="button" aria-label={`Drill into ${r.source_channel}`} onClick={() => drill.openDrill(`Source: ${r.source_channel}`, { source: r.source_channel })} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && drill.openDrill(`Source: ${r.source_channel}`, { source: r.source_channel })} className="cursor-pointer border-t transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                        <td className="py-2 font-medium">{r.source_channel}</td><td className="text-right tabular-nums">{fmt(r.total_candidates)}</td><td className="text-right tabular-nums">{fmt(r.total_hired)}</td>
                        <td className="pl-4"><div className="flex items-center gap-2"><div className="flex-1"><RateBar value={Math.min(100, r.conversion_rate * 4)} color={V.aqua} /></div><span className="w-12 text-right text-xs tabular-nums">{r.conversion_rate}%</span></div></td></tr>))}</tbody></table></div>
                ) : <Empty text={roi.isLoading ? "Loading…" : roi.isError ? "Channel conversion is not available for your role" : "No hires recorded"} />}
              </Panel>
              <Panel i={8} className="lg:col-span-5" title="Time to hire" hint="Stage-tracked hires only, so the sample is small" icon={<Timer className="h-4 w-4" />}>
                {tth.data ? (
                  <>
                    <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                      {[["Average", tth.data.overall_avg_days], ["Fastest", tth.data.fastest_hire_days], ["Slowest", tth.data.slowest_hire_days]].map(([l, v]) => (
                        <div key={l as string} className="rounded-xl bg-muted/50 p-2"><div className="text-lg font-semibold tabular-nums">{v == null ? "-" : `${v}d`}</div><div className="text-[11px] text-muted-foreground">{l}</div></div>))}
                    </div>
                    <BarRows rows={tth.data.by_role.slice(0, 5).map((r) => ({ label: r.role, value: r.avg_days }))} color={V.violet} format={(n) => `${n}d`} />
                  </>
                ) : <Empty text={tth.isLoading ? "Loading…" : "Not available"} />}
              </Panel>
            </div>

            <Panel i={9} title="Registrations vs selections" hint="Last 6 months, all channels" icon={<TrendingUp className="h-4 w-4" />}>
              {trend6.data?.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={trend6.data} margin={{ left: -14, right: 6 }}>
                    <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="month" tick={tick} tickFormatter={monthLabel} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip {...tooltipStyle} labelFormatter={monthLabel} cursor={{ fill: V.track }} /><Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                    <Bar dataKey="registrations" name="Registrations" fill={V.blue} radius={[6, 6, 0, 0]} /><Bar dataKey="selections" name="Selections" fill={V.aqua} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <Empty text={trend6.isLoading ? "Loading…" : "Not available"} />}
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel i={7} title="Recruiter sourcing leaderboard" hint="Call and walk-in performance per recruiter" icon={<Trophy className="h-4 w-4" />}>
                {d.recruiters.length ? (
                  <ol className="max-h-96 space-y-3 overflow-auto pr-1">{d.recruiters.map((r, i) => (
                    <li key={r.name} tabIndex={0} role="button" aria-label={`Drill into ${r.name}`} onClick={() => leads(`Recruiter: ${r.name}`, { ...legacy, recruiter: r.name })} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && leads(`Recruiter: ${r.name}`, { ...legacy, recruiter: r.name })} className="cursor-pointer rounded-lg p-1 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                      <div className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate font-medium"><span className="mr-2 text-xs text-muted-foreground">{i + 1}</span>{r.name}</span><span className="shrink-0 tabular-nums text-muted-foreground">{fmt(r.sourced)} leads</span></div>
                      <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground"><div><RateBar value={r.contactRate} color={V.aqua} />{r.contactRate}% contacted</div><div><RateBar value={Math.min(100, r.walkinRate * 4)} color={V.violet} />{r.walkinRate}% walked in · {fmt(r.selected)} selected</div></div>
                    </li>))}</ol>
                ) : <Empty />}
              </Panel>
              <div className="grid gap-4">
                <Panel i={8} title="Why leads drop before joining" hint="Reason logged by recruiter, HR or ops" icon={<PhoneOff className="h-4 w-4" />}><BarRows rows={d.rejectionReasons.map((r) => ({ label: r.reason, value: r.n }))} color={V.orange} onSelect={(l) => leads(`Reason: ${l}`, { reason: l })} /></Panel>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Panel i={9} title="Top referrers" icon={<Users className="h-4 w-4" />}>{d.referrers.length ? <BarRows rows={d.referrers.map((r) => ({ label: r.name, value: r.referred, sub: `${r.joined} joined` }))} color={V.violet} /> : <Empty text="No referral records" />}</Panel>
                  <Panel i={10} title="Data quality" icon={<Copy className="h-4 w-4" />}>
                    <ul className="space-y-2 text-sm"><li className="flex justify-between"><span className="text-muted-foreground">Duplicate warnings</span><b className="tabular-nums">{fmt(d.duplicateWarnings)}</b></li><li className="flex justify-between"><span className="text-muted-foreground">Leads never contacted</span><b className="tabular-nums">{fmt(uncontacted)}</b></li></ul>
                  </Panel>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel i={11} title="Walk-in registrations by channel" hint={`Registered in the ATS, last ${period === "all" ? "90 days" : period.toUpperCase()}; shade = selection rate`} icon={<GitBranch className="h-4 w-4" />}>
                {ov ? <SourceTreemap data={ov.sources} onSelect={(n) => drill.openDrill(`Source: ${n}`, { source: n, from: periodFrom(period === "all" ? "90d" : period) })} /> : <Skeleton className="h-64" />}
              </Panel>
              {d.legacyWalkin && (
                <Panel i={12} title="Historical walk-in hires" hint="Bulk-imported recruiter records with no recruiter attribution" icon={<Archive className="h-4 w-4" />}>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    {[["Records", d.legacyWalkin.sourced], ["Selected", d.legacyWalkin.selected], ["Joined", d.legacyWalkin.joined]].map(([l, v]) => (
                      <div key={l as string} className="rounded-xl bg-muted/50 p-3"><div className="text-xl font-semibold tabular-nums">{fmt(v as number)}</div><div className="text-xs text-muted-foreground">{l}</div></div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">Kept separate so the sourcing funnel reflects live recruiter activity. {d.legacyWalkin.joinRate}% of selected records show as joined.</p>
                </Panel>
              )}
            </div>
          </div>
        )}
        </>); }}
      </DashboardFrame>
    </DashboardLayout>
  );
}

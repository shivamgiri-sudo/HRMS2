import { useMemo, type ReactNode } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BadgeCheck, GitBranch, Grid3x3, Lightbulb, Network, ShieldCheck, TrendingUp, UserCheck, UserX, Users, Percent, PhoneOff, Handshake } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useDrill, type DrillFilters } from "@/hooks/useAtsDashboards";
import { useCohorts, useLeakage } from "@/hooks/useAtsCommandCenter";
import { useDrillActions } from "@/components/ats/overview/drill";
import { periodFrom } from "@/components/ats/overview/shell";
import { BarRows, Empty, V, fmt, tooltipStyle } from "@/components/ats/overview/viz";
import { Card, ExportButton, FilterBar, HeatTable, InsightList, KpiCard, Section, Waterfall, downloadCsv, type HeatCol } from "./cc-kit";
import { useCC } from "./cc-context";
import { humanizeStage } from "./stage-label";
import { leakageOutcome, monthEnd, monthLabel } from "./outcomes-helpers";
import { bgvSurvival, buildScopedFindings, offersApproved, outcomeRows, rankStageRejections, type OutcomeRow } from "./outcomes-scoped-helpers";

const tick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const pct = (n: number) => `${n}%`;
const r1 = (n: number) => Math.round(n * 10) / 10;
const names = (rows: { name: string }[] | undefined) => (rows ?? []).map((r) => r.name).filter((n) => n && n !== "Unspecified" && n !== "Unmapped").sort((a, b) => a.localeCompare(b));
const addDays = (iso: string, d: number) => { const t = new Date(`${iso.slice(0, 10)}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

/** One panel's data states: a failing call shows an inline message here and never blanks the rest of the tab. */
function Gate({ q, h = "h-52", what, children }: { q: { isLoading: boolean; isError: boolean; data?: unknown }; h?: string; what: string; children: ReactNode }) {
  if (q.isError && !q.data) return <div role="alert" className="flex h-24 items-center justify-center rounded-xl border border-red-300 bg-red-50 px-3 text-center text-sm text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">Could not load {what}</div>;
  if (q.isLoading || !q.data) return <Skeleton className={`${h} rounded-xl`} aria-busy="true" />;
  return <>{children}</>;
}

export function OutcomesScopedTab() {
  const cc = useCC();
  const act = useDrillActions();
  const from = periodFrom(cc.period);
  const base = useMemo(() => cc.drill(), [cc]);
  const baseKey = JSON.stringify(base);
  const open = useMemo<DrillFilters>(() => (from ? { from } : {}), [from]);
  const optsQ = useDrill(open);
  const dq = useDrill(base);
  const leak = useLeakage(base);
  const cf = useMemo<DrillFilters>(() => ({ branch: cc.branch || undefined, process: cc.process || undefined, recruiter: cc.recruiter || undefined }), [cc.branch, cc.process, cc.recruiter]);
  const cohorts = useCohorts(12, cf);
  const go = (crumb: string, extra: DrillFilters = {}) => act.openDrill(crumb, { ...base, ...extra });
  const stepLabel = (key: string) => leak.data?.stages.find((x) => x.key === key)?.label ?? humanizeStage(key);

  const d = dq.data;
  const findings = useMemo(() => buildScopedFindings({ drill: d, leakage: leak.data, cohorts: cohorts.data }).map((f) => ({ tone: f.tone, title: f.title, body: f.body, onClick: f.drill ? () => go(f.drill!.crumb, f.drill!.extra) : undefined })), [d, leak.data, cohorts.data, baseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = d?.kpis;
  const approved = offersApproved(leak.data), bgv = bgvSurvival(leak.data);
  const stageRej = useMemo(() => rankStageRejections(d?.splits?.stage), [d]);
  const lossRows = (leak.data?.losses ?? []).slice().sort((a, b) => b.n - a.n).slice(0, 8);
  const trend = (d?.trend ?? []).map((t) => ({ ...t, other: Math.max(0, t.total - t.selected - t.rejected), selRate: t.total ? r1((t.selected / t.total) * 100) : 0, label: t.date.length === 7 ? monthLabel(t.date) : new Date(`${t.date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) }));
  const trendDrill = (outcome: string | undefined, name: string) => (p: { date?: string }) => {
    if (!p.date) return;
    const s = p.date.length === 7 ? `${p.date}-01` : p.date.slice(0, 10), e = p.date.length === 7 ? monthEnd(p.date) : d?.weekly ? addDays(s, 6) : s;
    go(`${name} · ${s}`, { from: s, to: e, outcome });
  };

  const outcomeCols = (dim: "process" | "source" | "recruiter"): HeatCol<OutcomeRow>[] => [
    { key: "t", label: "Candidates", get: (r) => r.total },
    { key: "s", label: "Selected %", get: (r) => r.selRate, format: pct, hue: "green" },
    { key: "r", label: "Rejected %", get: (r) => r.rejRate, format: pct, hue: "red" },
    { key: "n", label: "No-show %", get: (r) => r.noShowRate, format: pct, hue: "red" },
    { key: "j", label: "Joined %", get: (r) => r.joinRate, format: pct, hue: "green" },
  ].map((c) => c as HeatCol<OutcomeRow>);
  const OUT: Record<string, string | undefined> = { s: "selected", r: "rejected", n: "noShow", j: "joined" };
  const mix = (i: number, dim: "process" | "source" | "recruiter", title: string, hint: string, icon: ReactNode) => {
    const rows = outcomeRows(d?.splits?.[dim]);
    return (
      <Card i={i} title={title} hint={hint} icon={icon} right={rows.length > 0 && <ExportButton onClick={() => downloadCsv(`ats-outcomes-by-${dim}.csv`, [dim, "Candidates", "Selected %", "Rejected %", "No-show %", "Joined %"], rows.map((r) => [r.name, r.total, r.selRate, r.rejRate, r.noShowRate, r.joinRate]))} />}>
        <Gate q={dq} what={`outcomes by ${dim}`}>
          {rows.length ? <HeatTable rows={rows} max={12} cols={outcomeCols(dim)} onRow={(r) => go(`${title.replace("Outcome mix by ", "")}: ${r.name}`, { [dim]: r.name } as DrillFilters)}
            onCell={(r, c) => go(`${r.name} · ${c.label.replace(" %", "")}`, { [dim]: r.name, outcome: OUT[c.key] } as DrillFilters)} /> : <Empty text={`No ${dim} data in this view`} />}
        </Gate>
      </Card>
    );
  };

  const cohortRows = (cohorts.data?.cohorts ?? []).filter((c) => c.total).slice().reverse().map((c) => ({ ...c, name: `Week of ${c.week}` }));
  const weekDrill = (r: { week: string; name: string }, label: string, outcome?: string) => go(label, { from: r.week, to: addDays(r.week, 6), outcome });

  return (
    <div className={`space-y-5 transition-opacity duration-200 ${dq.isFetching ? "opacity-90" : ""}`}>
      <FilterBar show={["period", "process", "recruiter"]} processes={names(optsQ.data?.splits?.process)} recruiters={names(optsQ.data?.splits?.recruiter)} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {d && k ? (<>
          <KpiCard i={0} label="Selection rate" value={k.selRate} suffix="%" decimals={k.selRate % 1 ? 1 : 0} sub={`${fmt(k.selected)} selected`} icon={<UserCheck className="h-4 w-4" />} color={V.aqua} onClick={() => go("Selected", { outcome: "selected" })} />
          <KpiCard i={1} label="Rejection rate" value={k.rejRate} suffix="%" decimals={k.rejRate % 1 ? 1 : 0} deltaInvert sub={`${fmt(k.rejected)} rejected`} icon={<UserX className="h-4 w-4" />} color={V.orange} onClick={() => go("Rejected", { outcome: "rejected" })} />
          <KpiCard i={2} label="No-show rate" value={k.noShowRate} suffix="%" decimals={k.noShowRate % 1 ? 1 : 0} deltaInvert sub={`${fmt(k.noShow)} no-shows`} icon={<PhoneOff className="h-4 w-4" />} color={V.red} onClick={() => go("No-show", { outcome: "noShow" })} />
          <KpiCard i={3} label="Join rate" value={k.selected ? r1((k.joined / k.selected) * 100) : 0} suffix="%" decimals={1} sub={`${fmt(k.joined)} joined of ${fmt(k.selected)} selected`} icon={<Handshake className="h-4 w-4" />} color={V.violet} onClick={() => go("Joined", { outcome: "joined" })} />
          <KpiCard i={4} label="Offers approved" value={approved?.pct ?? 0} suffix="%" decimals={approved && approved.pct % 1 ? 1 : 0} sub={approved ? `${fmt(approved.n)} of ${fmt(approved.of)}` : leak.isLoading ? "Loading" : "Not available"} icon={<BadgeCheck className="h-4 w-4" />} color={V.yellow} onClick={approved ? () => go(approved.label, { outcome: leakageOutcome(approved.key, approved.label) }) : undefined} />
          <KpiCard i={5} label="BGV survival" value={bgv?.pct ?? 0} suffix="%" decimals={bgv && bgv.pct % 1 ? 1 : 0} sub={bgv ? `${fmt(bgv.n)} of ${fmt(bgv.of)} cleared` : leak.isLoading ? "Loading" : "Not available"} icon={<ShieldCheck className="h-4 w-4" />} color={V.aqua} onClick={bgv ? () => go(bgv.label, { outcome: leakageOutcome(bgv.key, bgv.label) }) : undefined} />
          <KpiCard i={6} label="Candidates in view" value={k.total} sub={`${fmt(k.waiting + k.hold)} waiting or on hold`} icon={<Users className="h-4 w-4" />} color={V.blue} onClick={() => go("Candidates in view")} />
        </>) : dq.isError ? <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 sm:col-span-2 lg:col-span-4 xl:col-span-7 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">Could not load outcome metrics: {(dq.error as Error)?.message}</div>
          : [0, 1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
      </div>

      <Card i={1} title="What the data says" hint="Written findings from this view · click one to drill" icon={<Lightbulb className="h-4 w-4" />}>
        <Gate q={dq} h="h-32" what="findings"><InsightList items={findings} empty="Not enough data for findings" /></Gate>
      </Card>

      <Section title="Where candidates are rejected" hint="The stage a candidate was at when they were rejected">
        <Card i={2} title="Rejections by stage" hint="Bar is the rejected count, the label shows the rate at that stage · click a bar to drill" icon={<GitBranch className="h-4 w-4" />}>
          <Gate q={dq} h="h-40" what="rejections by stage">
            {stageRej.length ? <BarRows rows={stageRej.slice(0, 10).map((s, i) => ({ label: humanizeStage(s.name), value: s.rejected, sub: `${s.rate}% of ${fmt(s.total)} · ${s.share}% of rejections`, color: i === 0 ? V.red : V.orange }))} onSelect={(l) => { const raw = stageRej.find((s) => humanizeStage(s.name) === l)?.name ?? l; go(`Rejected at ${l}`, { stage: raw, outcome: "rejected" }); }} /> : <Empty text="No rejections by stage in this view" />}
          </Gate>
        </Card>
      </Section>

      <Section title="Outcome mix" hint="How each group's candidates ended up · click a name or a cell to drill">
        {mix(3, "process", "Outcome mix by process", "Processes ranked by candidates", <Grid3x3 className="h-4 w-4" />)}
        {mix(4, "source", "Outcome mix by source", "Where candidates came from", <Network className="h-4 w-4" />)}
        {mix(5, "recruiter", "Outcome mix by recruiter", "Recruiters ranked by candidates handled", <Users className="h-4 w-4" />)}
      </Section>

      <Section title="Offer-to-join leakage" hint="Selected candidates who never made it to a desk">
        <div className="grid gap-4 lg:grid-cols-12">
          <Card i={6} className="lg:col-span-6" title="Selected to joined" hint="Bars are survivors; the shaded part is what was lost" icon={<TrendingUp className="h-4 w-4" />}>
            <Gate q={leak} what="leakage">
              {leak.data?.stages.length ? <Waterfall steps={leak.data.stages} onStep={(key) => { const s = leak.data!.stages.find((x) => x.key === key); go(s?.label ?? key, { outcome: leakageOutcome(key, s?.label) }); }} /> : <Empty text="No offers in this window" />}
            </Gate>
          </Card>
          <Card i={7} className="lg:col-span-6" title="Why they dropped" hint="Largest losses with the recorded reason"
            right={lossRows.length > 0 && <ExportButton onClick={() => downloadCsv("ats-offer-leakage.csv", ["From", "To", "Reason", "Candidates"], lossRows.map((l) => [stepLabel(l.from), stepLabel(l.to), l.reason, l.n]))} />}>
            <Gate q={leak} what="losses">
              {lossRows.length ? (
                <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Step</th><th className="px-2 py-2 font-medium">Reason</th><th className="px-3 py-2 text-right font-medium">Lost</th></tr></thead>
                  <tbody>{lossRows.map((l, i) => (
                    <tr key={i} className="border-t"><td className="px-3 py-1.5 text-xs text-muted-foreground">{stepLabel(l.from)} to {stepLabel(l.to)}</td>
                      <td className="px-2 py-1.5"><button onClick={() => go(`${l.reason} · ${stepLabel(l.from)}`, { outcome: leakageOutcome(l.from, stepLabel(l.from)) })} className="cursor-pointer text-left font-medium hover:text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{l.reason}</button></td>
                      <td className="cc-num px-3 py-1.5 text-right font-semibold">{fmt(l.n)}</td></tr>))}</tbody></table></div>
              ) : <Empty text="No recorded losses" />}
            </Gate>
          </Card>
        </div>
      </Section>

      <Section title="Cohorts and trend" hint="Same people tracked over time">
        <Card i={8} title="Weekly cohorts" hint="Everyone who registered in a week, and where they stand now · click a row or cell to drill" icon={<Network className="h-4 w-4" />}
          right={cohortRows.length > 0 && <ExportButton onClick={() => downloadCsv("ats-outcome-cohorts.csv", ["Week", "Registered", "Selected %", "No-show %", "Joined %", "Median days to decision"], cohortRows.map((c) => [c.week, c.total, c.selRate, c.noShowRate, c.joinRate, c.medianDaysToDecision]))} />}>
          <Gate q={cohorts} what="weekly cohorts">
            {cohortRows.length ? (
              <HeatTable rows={cohortRows} max={12}
                cols={[
                  { key: "t", label: "Registered", get: (r) => r.total },
                  { key: "s", label: "Selected %", get: (r) => r.selRate, format: pct, hue: "green" },
                  { key: "n", label: "No-show %", get: (r) => r.noShowRate, format: pct, invert: true, hue: "red" },
                  { key: "j", label: "Joined %", get: (r) => r.joinRate, format: pct, hue: "green" },
                  { key: "d", label: "Median days to decide", get: (r) => r.medianDaysToDecision ?? 0, format: (n) => (n ? `${n}d` : "–"), invert: true, hue: "blue" },
                ]}
                onRow={(r) => weekDrill(r, r.name)}
                onCell={(r, c) => weekDrill(r, `${r.name} · ${c.label}`, c.key === "s" ? "selected" : c.key === "n" ? "noShow" : c.key === "j" ? "joined" : undefined)} />
            ) : <Empty text="No registrations in the last 12 weeks" />}
          </Gate>
        </Card>
        <Card i={9} title={d?.weekly ? "Weekly outcomes" : "Daily outcomes"} hint="Stacked outcomes with the selection-rate line · click a bar to drill" icon={<TrendingUp className="h-4 w-4" />}>
          <Gate q={dq} h="h-72" what="the trend">
            {trend.length ? (
              <div role="img" aria-label={`Outcome trend over ${trend.length} ${d?.weekly ? "weeks" : "days"} with selection rate line`}>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={trend} margin={{ left: -10, right: 4 }}>
                    <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} minTickGap={16} />
                    <YAxis yAxisId="n" tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis yAxisId="r" orientation="right" unit="%" tick={tick} axisLine={false} tickLine={false} domain={[0, "auto"]} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} /><Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                    <Bar yAxisId="n" dataKey="selected" name="Selected" stackId="a" fill={V.aqua} className="cursor-pointer" onClick={trendDrill("selected", "Selected")} />
                    <Bar yAxisId="n" dataKey="rejected" name="Rejected" stackId="a" fill={V.orange} className="cursor-pointer" onClick={trendDrill("rejected", "Rejected")} />
                    <Bar yAxisId="n" dataKey="other" name="Other" stackId="a" fill={V.track} radius={[6, 6, 0, 0]} className="cursor-pointer" onClick={trendDrill(undefined, "All")} />
                    <Line yAxisId="r" type="monotone" dataKey="selRate" name="Selection rate %" stroke={V.blue} strokeWidth={2.5} dot={trend.length > 31 ? false : { r: 3, stroke: "hsl(var(--card))", strokeWidth: 2, fill: V.blue }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : <Empty text="No registrations in this period" />}
          </Gate>
        </Card>
      </Section>
    </div>
  );
}
